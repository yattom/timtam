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
   * Recall形式:
   * {
   *   bot_id: string;
   *   speaker: { participant_id: string, name?: string };
   *   words: Array<{ text: string, start_time: number, end_time: number }>;
   *   is_partial: boolean;
   *   sequence_number: number;
   * }
   *
   * @param payload - Recall.ai Webhookペイロード
   * @returns TranscriptEvent
   */
  processInboundTranscript(payload: any): TranscriptEvent {
    const {
      bot_id,
      speaker,
      words,
      is_partial,
      sequence_number,
    } = payload;

    if (!bot_id || !speaker || !Array.isArray(words)) {
      throw new Error('Invalid Recall.ai transcript payload');
    }

    // words配列からテキストを結合
    const text = words.map((w: any) => w.text).join(' ');

    // 発話時刻はwords配列のstart_time/end_timeを優先的に利用し、なければ現在時刻を使用
    const firstWord = words[0];
    const lastWord = words[words.length - 1];
    let timestampFromWords: number | undefined;

    if (firstWord && typeof firstWord.start_time === 'number') {
      timestampFromWords = firstWord.start_time;
    } else if (lastWord && typeof lastWord.end_time === 'number') {
      timestampFromWords = lastWord.end_time;
    }

    return {
      meetingId: bot_id as MeetingId,
      speakerId: speaker.participant_id || speaker.name || 'unknown',
      text,
      isFinal: !is_partial, // Recallはis_partialなので反転
      timestamp: timestampFromWords ?? Date.now(), // words由来のタイムスタンプがなければ現在時刻
      sequenceNumber: sequence_number,
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
   * @param meetingId - 会議ID（botId）
   * @param message - 送信するメッセージ
   */
  async postChat(meetingId: MeetingId, message: string): Promise<void> {
    const botId = meetingId as string; // Recall.aiではmeetingId = botId

    try {
      await this.recallClient.sendChatMessage(botId, {
        message,
        pin_message: false,
      });

      console.log(JSON.stringify({
        type: 'recall.chat.post',
        meetingId,
        botId,
        messageLength: message.length,
        timestamp: Date.now(),
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
