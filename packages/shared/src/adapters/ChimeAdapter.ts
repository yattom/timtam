/**
 * ChimeAdapter - Chime SDK用のMeetingServiceAdapter実装
 * ADR 0014に基づく、Chime固有のロジックをカプセル化
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { MeetingServiceAdapter } from './MeetingServiceAdapter';
import { MeetingId, TranscriptEvent } from '../types/events';

export interface ChimeAdapterConfig {
  /** DynamoDB テーブル名（AI応答メッセージ保存用） */
  aiMessagesTable: string;

  /** DynamoDBクライアント（オプション、テスト用） */
  ddbClient?: DynamoDBClient;
}

/**
 * ChimeAdapter
 *
 * INBOUND（Lambda用）:
 * - processInboundTranscript: Chime SDK形式 → TranscriptEvent
 *
 * OUTBOUND（Orchestrator用）:
 * - postChat: DynamoDBにメッセージ書き込み（ブラウザがポーリング）
 * - postLlmCallLog: DynamoDBにLLMログ書き込み
 */
export class ChimeAdapter implements MeetingServiceAdapter {
  private ddb: DynamoDBDocumentClient;
  private aiMessagesTable: string;

  constructor(config: ChimeAdapterConfig) {
    const ddbClient = config.ddbClient || new DynamoDBClient({});
    this.ddb = DynamoDBDocumentClient.from(ddbClient);
    this.aiMessagesTable = config.aiMessagesTable;
  }

  // ========================================
  // INBOUND: Chime形式 → 統一形式
  // ========================================

  /**
   * Chime SDK文字起こし → TranscriptEvent
   *
   * Chime形式:
   * {
   *   attendeeId: string;
   *   externalUserId?: string;
   *   text: string;
   *   isFinal: boolean;
   *   timestamp?: number;
   *   resultId?: string;
   * }
   *
   * @param payload - Chime SDKペイロード（Lambda event.body）
   * @returns TranscriptEvent
   */
  processInboundTranscript(payload: any): TranscriptEvent {
    const {
      meetingId,
      attendeeId,
      externalUserId,
      text,
      isFinal,
      timestamp,
    } = payload;

    if (!meetingId || !attendeeId || typeof text !== 'string' || typeof isFinal !== 'boolean') {
      throw new Error('Invalid Chime transcript payload');
    }

    return {
      meetingId: meetingId as MeetingId,
      speakerId: externalUserId || attendeeId, // Prefer externalUserId
      text,
      isFinal,
      timestamp: timestamp || Date.now(),
      sequenceNumber: undefined, // Chimeにはsequence numberなし
    };
  }

  // ========================================
  // OUTBOUND: DynamoDB書き込み
  // ========================================

  /**
   * チャットメッセージ送信（Chime SDKは外部APIなし）
   *
   * NOTE: DynamoDB保存はMeetingOrchestratorの共通処理で行われる
   *       Chime SDKには外部チャットAPIがないため、このメソッドは何もしない
   *
   * @param meetingId - 会議ID
   * @param message - 送信するメッセージ
   */
  async postChat(meetingId: MeetingId, message: string): Promise<void> {
    // Chime SDKには外部チャットAPIがないため何もしない
    // DynamoDB保存はMeetingOrchestratorで行われる
    console.log(JSON.stringify({
      type: 'chime.chat.noop',
      meetingId,
      messageLength: message.length,
      reason: 'no-external-api',
    }));
  }

  /**
   * LLM呼び出しログをDynamoDBに書き込み
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
        type: 'chime.llm_call.logged',
        meetingId,
        nodeId,
        promptLength: prompt.length,
        responseLength: rawResponse.length,
        timestamp,
      }));
    } catch (err: any) {
      console.error('ChimeAdapter: Failed to store LLM call log', {
        error: err?.message || err,
        meetingId,
        nodeId,
      });
    }
  }
}
