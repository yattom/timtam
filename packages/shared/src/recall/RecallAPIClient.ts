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
 */
export interface CreateBotRequest {
  /** Zoom/Meet/TeamsのURL */
  meeting_url: string;

  /** ボット名（会議に表示される名前） */
  bot_name?: string;

  /** 文字起こしオプション */
  transcription_options?: {
    /** 文字起こしプロバイダー（デフォルト: 'recall'） */
    provider?: 'recall' | 'assembly_ai' | 'deepgram';

    /** リアルタイム配信を有効化 */
    realtime?: boolean;

    /** 部分結果を有効化（streaming） */
    partial_results?: boolean;
  };

  /** チャット設定 */
  chat?: {
    /** ボット参加時のメッセージ */
    on_bot_join?: {
      send_to: 'everyone' | 'host';
      message: string;
    };
  };

  /** Webhookエンドポイント設定 */
  real_time_transcription?: {
    /** Webhook配信先URL */
    destination_url: string;
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
   * ボットを削除（会議から退出）
   *
   * DELETE /api/v1/bot/{bot_id}/
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
