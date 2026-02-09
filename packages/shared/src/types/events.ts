/**
 * 統一イベント型定義
 * ADR 0014に基づく、プラットフォーム非依存の文字起こしイベント
 */

/**
 * MeetingId - 会議の一意識別子
 * Chime: meetingId、Recall: botId
 */
export type MeetingId = string & { readonly __brand: 'MeetingId' };

/**
 * TranscriptEvent - 統一文字起こしイベント
 * すべての会議サービスからこの形式に変換される
 */
export interface TranscriptEvent {
  /** 会議ID（Chime: meetingId, Recall: botId） */
  meetingId: MeetingId;

  /** 発言者ID（Chime: externalUserId || attendeeId, Recall: participant_id） */
  speakerId: string;

  /** 文字起こしテキスト */
  text: string;

  /** 確定フラグ（partial=false, final=true） */
  isFinal: boolean;

  /** エポックミリ秒 */
  timestamp: number;

  /** シーケンス番号（順序保証用、オプション） */
  sequenceNumber?: number;
}

/**
 * ParticipantEvent - 参加者イベント（将来用、TBD）
 */
export interface ParticipantEvent {
  type: 'join' | 'leave' | 'speaking' | 'muted';
  participantId: string;
  participantName?: string;
  timestamp: number;
}

/**
 * MeetingEndedEvent - ミーティング終了イベント
 * Webhookまたは手動終了時にSQS経由でOrchestratorに送信される
 */
export interface MeetingEndedEvent {
  /** イベントタイプ */
  type: 'meeting.ended';

  /** 会議ID */
  meetingId: MeetingId;

  /** 終了理由 */
  reason: 'bot.status.done' | 'bot.status.error' | 'bot.status.fatal' | 'manual.delete';

  /** エポックミリ秒 */
  timestamp: number;
}

/**
 * MeetingInfo - 会議参加情報
 */
export interface MeetingInfo {
  meetingId: MeetingId;
  platform: 'chime' | 'recall';

  // Chime SDK固有
  chimeConfig?: {
    Meeting: any; // ChimeMeeting
    Attendee: any; // ChimeAttendee
  };

  // Recall.ai固有
  recallConfig?: {
    meetingUrl: string;
    botName?: string;
  };
}
