/**
 * RecallAdapter - Recall.ai用のMeetingServiceAdapter実装（Phase 2）
 * ADR 0014に基づく、Recall.ai固有のロジックをカプセル化
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { MeetingServiceAdapter } from './MeetingServiceAdapter';
import { MeetingId, TranscriptEvent } from '../types/events';
import { RecallAPIClient } from '../recall/RecallAPIClient';

export interface RecallAdapterConfig {
  /** Recall.ai APIキー */
  apiKey: string;

  /** Recall.ai APIベースURL（デフォルト: https://us-west-2.recall.ai） */
  apiBaseUrl?: string;

  /** DynamoDB テーブル名（AI応答メッセージ保存用、LLMログ用） */
  aiMessagesTable: string;

  /** DynamoDBクライアント（オプション、テスト用） */
  ddbClient?: DynamoDBClient;
}

/**
 * RecallAdapter
 *
 * INBOUND（Lambda用）:
 * - processInboundTranscript: Recall.ai Webhook形式 → TranscriptEvent
 *
 * OUTBOUND（Orchestrator用）:
 * - postChat: Recall.ai Chat API呼び出し
 * - postLlmCallLog: DynamoDBにLLMログ書き込み（Chimeと同じテーブル）
 *
 * @note Phase 2で完全実装
 */
export class RecallAdapter implements MeetingServiceAdapter {
  private recallClient: RecallAPIClient;
  private ddb: DynamoDBDocumentClient;
  private aiMessagesTable: string;

  constructor(config: RecallAdapterConfig) {
    this.recallClient = new RecallAPIClient({
      apiKey: config.apiKey,
      apiBaseUrl: config.apiBaseUrl,
    });

    const ddbClient = config.ddbClient || new DynamoDBClient({});
    this.ddb = DynamoDBDocumentClient.from(ddbClient);
    this.aiMessagesTable = config.aiMessagesTable;
  }

  // ========================================
  // INBOUND: Recall形式 → 統一形式
  // ========================================

  /**
   * Recall.ai Webhook → TranscriptEvent
   *
   * Recall形式 (実際のWebhook構造):
   * {
   *   event: "transcript.data",
   *   data: {
   *     bot: { id: string, metadata: {} },
   *     data: {
   *       words: Array<{
   *         text: string,
   *         start_timestamp: { relative: number, absolute: string },
   *         end_timestamp: { relative: number, absolute: string }
   *       }>,
   *       participant: { id: number, name: string, is_host: boolean, platform: string }
   *     },
   *     transcript: { id: string, metadata: {} },
   *     realtime_endpoint: { id: string, metadata: {} },
   *     recording: { id: string, metadata: {} }
   *   }
   * }
   *
   * @param payload - Recall.ai Webhookペイロード
   * @returns TranscriptEvent
   */
  processInboundTranscript(payload: any): TranscriptEvent {
    const bot_id = payload.data?.bot?.id;
    const words = payload.data?.data?.words;
    const participant = payload.data?.data?.participant;
    const transcript_id = payload.data?.transcript?.id;

    if (!bot_id || !participant || !Array.isArray(words)) {
      console.error('RecallAdapter: Invalid payload structure', {
        hasData: !!payload.data,
        hasBot: !!payload.data?.bot,
        hasBotId: !!bot_id,
        hasDataData: !!payload.data?.data,
        hasWords: !!words,
        isWordsArray: Array.isArray(words),
        hasParticipant: !!participant,
      });
      throw new Error('Invalid Recall.ai transcript payload');
    }

    // words配列からテキストを結合
    // NOTE: Recallは現在language_code='ja'（日本語）のみを想定しているため、単語間にスペースを挿入しない。
    //       英語などスペース区切りの言語をサポートする場合は、ここを言語別に処理（例: join(' ')）するよう拡張すること。
    const text = words.map((w: any) => w.text).join('');

    // 発話時刻はwords配列のstart_timestamp/end_timestampを利用
    const firstWord = words[0];
    const lastWord = words[words.length - 1];
    let timestampFromWords: number | undefined;

    // start_timestamp.absoluteをミリ秒のタイムスタンプに変換
    if (firstWord && firstWord.start_timestamp?.absolute) {
      timestampFromWords = new Date(firstWord.start_timestamp.absolute).getTime();
    } else if (lastWord && lastWord.end_timestamp?.absolute) {
      timestampFromWords = new Date(lastWord.end_timestamp.absolute).getTime();
    }

    return {
      meetingId: bot_id as MeetingId,
      speakerId: participant?.name || participant?.id?.toString() || 'unknown',
      text,
      isFinal: true, // transcript.dataイベントは常に最終結果（partialは別イベント）
      timestamp: timestampFromWords ?? Date.now(),
      sequenceNumber: transcript_id, // transcript.idをシーケンス番号として使用
    };
  }

  // ========================================
  // OUTBOUND: Recall.ai API呼び出し
  // ========================================

  /**
   * Recall.ai Chat APIでメッセージ送信
   *
   * POST /api/v1/bot/{bot_id}/send_chat_message/
   *
   * NOTE: DynamoDB保存はMeetingOrchestratorの共通処理で行われる
   *
   * @param meetingId - 会議ID（botId）
   * @param message - 送信するメッセージ
   */
  async postChat(meetingId: MeetingId, message: string): Promise<void> {
    const botId = meetingId as string; // Recall.aiではmeetingId = botId
    const timestamp = Date.now();

    try {
      // Recall.ai Chat APIでメッセージ送信
      await this.recallClient.sendChatMessage(botId, {
        message,
        pin_message: false,
      });

      console.log(JSON.stringify({
        type: 'recall.chat.post',
        meetingId,
        botId,
        messageLength: message.length,
        timestamp,
        delivered: 'recall-api',
      }));
    } catch (err: any) {
      console.error('RecallAdapter: Failed to send chat message', {
        error: err?.message || err,
        meetingId,
        botId,
      });
      throw err;
    }
  }

  /**
   * LLM呼び出しログをDynamoDBに書き込み
   * （Chimeと同じDynamoDBテーブルを使用）
   *
   * @param meetingId - 会議ID
   * @param prompt - LLMプロンプト
   * @param rawResponse - LLM生レスポンス
   * @param nodeId - Grasp nodeId
   */
  async postLlmCallLog(
    meetingId: MeetingId,
    prompt: string,
    rawResponse: string,
    nodeId: string = 'default'
  ): Promise<void> {
    const timestamp = Date.now();
    const ttl = Math.floor(timestamp / 1000) + 86400; // 24時間後に削除

    const logData = {
      nodeId,
      prompt,
      rawResponse,
      timestamp,
    };

    try {
      await this.ddb.send(
        new PutCommand({
          TableName: this.aiMessagesTable,
          Item: {
            meetingId,
            timestamp,
            message: JSON.stringify(logData),
            ttl,
            type: 'llm_call',
          },
        })
      );

      console.log(JSON.stringify({
        type: 'recall.llm_call.logged',
        meetingId,
        nodeId,
        promptLength: prompt.length,
        responseLength: rawResponse.length,
        timestamp,
      }));
    } catch (err: any) {
      console.error('RecallAdapter: Failed to store LLM call log', {
        error: err?.message || err,
        meetingId,
        nodeId,
      });
    }
  }
}
