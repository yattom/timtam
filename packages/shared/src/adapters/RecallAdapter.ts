/**
 * RecallAdapter - Recall.ai用のMeetingServiceAdapter実装（Phase 2）
 * ADR 0014に基づく、Recall.ai固有のロジックをカプセル化
 */

import { MeetingServiceAdapter } from './MeetingServiceAdapter';
import { MeetingId, TranscriptEvent } from '../types/events';

export interface RecallAdapterConfig {
  /** Recall.ai APIキー */
  apiKey: string;

  /** Recall.ai APIベースURL（デフォルト: https://us-west-2.recall.ai） */
  apiBaseUrl?: string;
}

/**
 * RecallAdapter
 *
 * INBOUND（Lambda用）:
 * - processInboundTranscript: Recall.ai Webhook形式 → TranscriptEvent
 *
 * OUTBOUND（Orchestrator用）:
 * - postChat: Recall.ai Chat API呼び出し
 * - postLlmCallLog: DynamoDBにLLMログ書き込み
 *
 * @note Phase 2で完全実装予定
 */
export class RecallAdapter implements MeetingServiceAdapter {
  private apiKey: string;
  private apiBaseUrl: string;

  constructor(config: RecallAdapterConfig) {
    this.apiKey = config.apiKey;
    this.apiBaseUrl = config.apiBaseUrl || 'https://us-west-2.recall.ai';
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
    // Phase 2で実装
    throw new Error('RecallAdapter.postChat not implemented yet (Phase 2)');
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
    // Phase 2で実装（DynamoDBへの書き込みはChimeと同じ）
    throw new Error('RecallAdapter.postLlmCallLog not implemented yet (Phase 2)');
  }
}
