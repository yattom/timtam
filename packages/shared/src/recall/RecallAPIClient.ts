/**
 * RecallAPIClient - Recall.ai REST API クライアント
 * Phase 2で実装
 *
 * @see https://docs.recall.ai/reference/
 */

/**
 * サポートされている会議プラットフォーム
 */
export type MeetingPlatform = 'zoom' | 'google_meet' | 'microsoft_teams' | 'webex';

/**
 * サポートされているプラットフォームの配列（検証用）
 */
export const VALID_PLATFORMS: readonly MeetingPlatform[] = ['zoom', 'google_meet', 'microsoft_teams', 'webex'] as const;

/**
 * 値が有効なMeetingPlatformかどうかを判定する型ガード
 */
export function isMeetingPlatform(value: unknown): value is MeetingPlatform {
  return typeof value === 'string' && VALID_PLATFORMS.includes(value as MeetingPlatform);
}

export interface RecallAPIConfig {
  /** Recall.ai APIキー */
  apiKey: string;

  /** Recall.ai APIベースURL（リージョン指定） */
  apiBaseUrl?: string;
}

/**
 * ボット作成リクエスト
 * 公式ドキュメント: https://docs.recall.ai/docs/bot-real-time-transcription
 */
export interface CreateBotRequest {
  /** Zoom/Meet/TeamsのURL */
  meeting_url: string;

  /** ボット名（会議に表示される名前） */
  bot_name?: string;

  /** チャット設定 */
  chat?: {
    /** ボット参加時のメッセージ */
    on_bot_join?: {
      send_to: 'everyone' | 'host';
      message: string;
    };
  };

  /** 録音設定（リアルタイム文字起こし含む） */
  recording_config?: {
    /** 文字起こし設定 */
    transcript?: {
      /** 文字起こしプロバイダー */
      provider?: {
        /** Recall.ai Streaming（リアルタイム文字起こし） */
        recallai_streaming?: {
          /** 言語コード (e.g., "ja" for Japanese, "auto" for auto-detection) */
          language_code?: string;
          /** モード (prioritize_accuracy または prioritize_low_latency) */
          mode?: 'prioritize_accuracy' | 'prioritize_low_latency';
        };
        /** Deepgram Streaming（サードパーティ文字起こし） */
        deepgram_streaming?: {
          /** 言語設定 (e.g., "auto" for auto-detection, "ja" for Japanese) */
          language?: string;
          /** モデル名 (オプション, e.g., "nova-2", "nova-3") */
          model?: string;
        };
      };
    };
    /** リアルタイムWebhookエンドポイント */
    realtime_endpoints?: Array<{
      /** エンドポイントタイプ */
      type: 'webhook';
      /** Webhook URL */
      url: string;
      /** イベントタイプ */
      events: Array<'transcript.data' | 'transcript.partial_data'>;
    }>;
    /** 録音保存期間（時間単位） */
    retention?:
      | {
          /** 保存オプション: 一定時間のみ保存 */
          type: 'timed';
          /** 保存時間（hours） */
          hours: number;
        }
      | {
          /** 保存オプション: 永久保存 */
          type: 'forever';
        };
  };

  /** 自動退出設定
   * @see https://docs.recall.ai/docs/automatic-leaving-behavior
   */
  automatic_leave?: {
    /** 待機室でのタイムアウト（秒）デフォルト: 1200秒 */
    waiting_room_timeout?: number;
    /** 誰も参加しない場合のタイムアウト（秒）デフォルト: 1200秒 */
    noone_joined_timeout?: number;
    /** 全員退出時の設定 */
    everyone_left_timeout?: {
      /** タイムアウト（秒）デフォルト: 2秒 */
      timeout: number;
      /** アクティベーション遅延（秒、オプション） */
      activate_after?: number | null;
    };
    /** 沈黙検出設定 */
    silence_detection?: {
      /** タイムアウト（秒）デフォルト: 3600秒 */
      timeout: number;
      /** アクティベーション遅延（秒）デフォルト: 1200秒 */
      activate_after: number;
    };
    /** 録音なし状態でのタイムアウト（秒）デフォルト: 3600秒 */
    in_call_not_recording_timeout?: number;
    /** 録音許可拒否時のタイムアウト（秒）デフォルト: 30秒 */
    recording_permission_denied_timeout?: number;
  };
}

/**
 * ボット情報
 */
export interface Bot {
  /** ボットID */
  id: string;

  /** 会議URL */
  meeting_url: string;

  /** ボット名 */
  bot_name: string;

  /** 状態 */
  status: 'starting' | 'in_meeting' | 'done' | 'error';

  /** 状態メッセージ */
  status_message?: string;

  /** プラットフォーム */
  platform?: MeetingPlatform;

  /** 作成日時 */
  created_at: string;
}

/**
 * チャットメッセージ送信リクエスト
 */
export interface SendChatMessageRequest {
  /** メッセージテキスト */
  message: string;

  /** メッセージをピン留めするか */
  pin_message?: boolean;
}

/**
 * Recall.ai APIクライアント
 */
export class RecallAPIClient {
  private apiKey: string;
  private apiBaseUrl: string;

  constructor(config: RecallAPIConfig) {
    this.apiKey = config.apiKey;
    this.apiBaseUrl = config.apiBaseUrl || 'https://us-west-2.recall.ai';
  }

  /**
   * ボットを作成して会議に参加
   *
   * POST /api/v1/bot/
   *
   * @param request ボット作成リクエスト
   * @returns ボット情報
   */
  async createBot(request: CreateBotRequest): Promise<Bot> {
    const response = await fetch(`${this.apiBaseUrl}/api/v1/bot/`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Recall.ai createBot failed: ${response.status} ${errorText}`);
    }

    return await response.json() as Bot;
  }

  /**
   * ボット情報を取得
   *
   * GET /api/v1/bot/{bot_id}/
   *
   * @param botId ボットID
   * @returns ボット情報
   */
  async getBot(botId: string): Promise<Bot> {
    const response = await fetch(`${this.apiBaseUrl}/api/v1/bot/${botId}/`, {
      method: 'GET',
      headers: {
        'Authorization': `Token ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Recall.ai getBot failed: ${response.status} ${errorText}`);
    }

    return await response.json() as Bot;
  }

  /**
   * ボットを削除（スケジュール済みの未参加ボットのみ）
   *
   * DELETE /api/v1/bot/{bot_id}/
   *
   * 注意: すでに会議に参加したボットは削除できません。
   * 会議中のボットを退出させるには leaveCall() を使用してください。
   *
   * @param botId ボットID
   */
  async deleteBot(botId: string): Promise<void> {
    const response = await fetch(`${this.apiBaseUrl}/api/v1/bot/${botId}/`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Token ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Recall.ai deleteBot failed: ${response.status} ${errorText}`);
    }
  }

  /**
   * ボットを会議から退出させる（すでに参加したボット用）
   *
   * POST /api/v1/bot/{bot_id}/leave_call/
   *
   * @param botId ボットID
   * @see https://docs.recall.ai/reference/bot_leave_call_create
   */
  async leaveCall(botId: string): Promise<void> {
    const response = await fetch(`${this.apiBaseUrl}/api/v1/bot/${botId}/leave_call/`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Recall.ai leaveCall failed: ${response.status} ${errorText}`);
    }
  }

  /**
   * ボットのメディアを削除（レコーディング、文字起こし等）
   *
   * POST /api/v1/bot/{bot_id}/delete_media/
   *
   * @param botId ボットID
   * @see https://docs.recall.ai/reference/bot_delete_media_create
   */
  async deleteMedia(botId: string): Promise<void> {
    const response = await fetch(`${this.apiBaseUrl}/api/v1/bot/${botId}/delete_media/`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Recall.ai deleteMedia failed: ${response.status} ${errorText}`);
    }
  }

  /**
   * 会議チャットにメッセージを送信
   *
   * POST /api/v1/bot/{bot_id}/send_chat_message/
   *
   * @param botId ボットID
   * @param request チャットメッセージリクエスト
   */
  async sendChatMessage(botId: string, request: SendChatMessageRequest): Promise<void> {
    const response = await fetch(`${this.apiBaseUrl}/api/v1/bot/${botId}/send_chat_message/`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Recall.ai sendChatMessage failed: ${response.status} ${errorText}`);
    }
  }

  /**
   * ボット一覧を取得
   *
   * GET /api/v1/bot/
   *
   * @param params クエリパラメータ
   * @returns ボット一覧
   */
  async listBots(params?: { status?: string; limit?: number }): Promise<{ results: Bot[] }> {
    const url = new URL(`${this.apiBaseUrl}/api/v1/bot/`);
    if (params?.status) {
      url.searchParams.append('status', params.status);
    }
    if (params?.limit) {
      url.searchParams.append('limit', params.limit.toString());
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Token ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Recall.ai listBots failed: ${response.status} ${errorText}`);
    }

    return await response.json() as { results: Bot[] };
  }
}
