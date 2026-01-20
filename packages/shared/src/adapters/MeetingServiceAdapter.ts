/**
 * 会議サービスへの統一インターフェース
 * ADR 0014に基づく、プラットフォーム固有の処理を抽象化
 */

import { MeetingId, TranscriptEvent, ParticipantEvent } from '../types/events';

/**
 * MeetingServiceAdapter インターフェース
 *
 * このインターフェースは2つの責務を持つ：
 * 1. INBOUND: サービス固有形式 → 統一TranscriptEventに変換（Lambda関数で使用）
 * 2. OUTBOUND: サービス固有エンドポイントに送信（Orchestratorで使用）
 */
export interface MeetingServiceAdapter {
  // ========================================
  // INBOUND: サービス形式 → 統一形式に変換
  // ========================================

  /**
   * サービス固有の文字起こし形式を統一TranscriptEventに変換
   * Lambda関数から呼ばれる
   *
   * @param payload - サービス固有のペイロード（Chime: {attendeeId, text, ...}, Recall: {bot_id, speaker, words, ...}）
   * @returns 統一TranscriptEvent
   */
  processInboundTranscript(payload: any): TranscriptEvent;

  /**
   * サービス固有の参加者イベントを統一ParticipantEventに変換（TBD）
   * Lambda関数から呼ばれる
   *
   * @param payload - サービス固有のペイロード
   * @returns 統一ParticipantEvent
   */
  processInboundParticipantEvent?(payload: any): ParticipantEvent;

  // ========================================
  // OUTBOUND: サービス固有エンドポイントに送信
  // ========================================

  /**
   * 会議サービスにチャットメッセージを送信
   * Orchestratorから呼ばれる
   *
   * @param meetingId - 会議ID
   * @param message - 送信するメッセージ
   */
  postChat(meetingId: MeetingId, message: string): Promise<void>;

  /**
   * デバッグ/監査用にLLM呼び出しをログ
   * Orchestratorから呼ばれる
   *
   * @param meetingId - 会議ID
   * @param prompt - LLMに送信したプロンプト
   * @param rawResponse - LLMからの生レスポンス
   * @param nodeId - Grasp nodeId（オプション）
   */
  postLlmCallLog(meetingId: MeetingId, prompt: string, rawResponse: string, nodeId?: string): Promise<void>;

  /**
   * 会議に音声出力を送信（将来、オプション）
   * Orchestratorから呼ばれる
   *
   * @param meetingId - 会議ID
   * @param audioData - 音声データ
   */
  postAudio?(meetingId: MeetingId, audioData: Buffer): Promise<void>;
}
