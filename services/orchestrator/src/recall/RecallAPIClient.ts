/**
 * Recall.ai API Client
 *
 * Client for interacting with Recall.ai's Meeting Bot API
 * Documentation: https://docs.recall.ai/
 */

export interface RecallBotConfig {
  meeting_url: string;
  bot_name?: string;
  transcription_options?: {
    provider: 'recall' | 'meeting_captions' | 'deepgram';
    realtime?: boolean;
    partial_results?: boolean;
  };
  chat?: {
    on_bot_join?: {
      send_to: 'everyone' | 'host';
      message: string;
    };
  };
  real_time_transcription?: {
    destination_url: string;
  };
  real_time_media?: {
    websocket_audio_output?: {
      url: string;
    };
  };
}

export interface RecallBot {
  id: string;
  meeting_url: string;
  bot_name: string;
  status: 'starting' | 'in_waiting_room' | 'in_meeting' | 'done' | 'error';
  join_at?: string;
  leave_at?: string;
}

export interface RecallTranscriptWord {
  text: string;
  start_time: number;
  end_time: number;
}

export interface RecallTranscriptEvent {
  bot_id: string;
  event_type: 'bot.transcript';
  sequence_number: number;
  is_partial: boolean;
  speaker: {
    participant_id: string;
    name?: string;
  };
  words: RecallTranscriptWord[];
}

export interface RecallParticipantEvent {
  bot_id: string;
  event_type: 'participant.join' | 'participant.leave';
  participant: {
    id: string;
    name: string;
    events: Array<{
      type: 'join' | 'leave';
      timestamp: string;
    }>;
  };
}

export class RecallAPIClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl: string = 'https://us-west-2.recall.ai') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  /**
   * Create a new bot and join a meeting
   * POST /api/v1/bot/
   */
  async createBot(config: RecallBotConfig): Promise<RecallBot> {
    const response = await fetch(`${this.baseUrl}/api/v1/bot/`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(config),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create bot: ${response.status} ${error}`);
    }

    return await response.json();
  }

  /**
   * Get bot status
   * GET /api/v1/bot/{bot_id}/
   */
  async getBot(botId: string): Promise<RecallBot> {
    const response = await fetch(`${this.baseUrl}/api/v1/bot/${botId}/`, {
      method: 'GET',
      headers: {
        'Authorization': `Token ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get bot: ${response.status} ${error}`);
    }

    return await response.json();
  }

  /**
   * Delete a bot (leave meeting)
   * DELETE /api/v1/bot/{bot_id}/
   */
  async deleteBot(botId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/v1/bot/${botId}/`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Token ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to delete bot: ${response.status} ${error}`);
    }
  }

  /**
   * Send a chat message
   * POST /api/v1/bot/{bot_id}/send_chat_message/
   */
  async sendChatMessage(
    botId: string,
    message: string,
    pinMessage: boolean = false
  ): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/api/v1/bot/${botId}/send_chat_message/`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Token ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message,
          pin_message: pinMessage,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to send chat message: ${response.status} ${error}`);
    }
  }

  /**
   * List all bots
   * GET /api/v1/bot/
   */
  async listBots(): Promise<RecallBot[]> {
    const response = await fetch(`${this.baseUrl}/api/v1/bot/`, {
      method: 'GET',
      headers: {
        'Authorization': `Token ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to list bots: ${response.status} ${error}`);
    }

    const data = await response.json();
    return data.results || [];
  }
}
