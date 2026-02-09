import { CreateBotRequest } from './RecallAPIClient';

export interface BuildCreateBotRequestParams {
  meetingUrl: string;
  botName: string;
  webhookUrl: string;
  transcriptionProvider: 'deepgram_streaming' | 'recallai_streaming';
  transcriptionLanguage: string;
}

/**
 * Recall.aiのCreateBotRequestを構築する
 *
 * @param params リクエスト構築パラメータ
 * @returns CreateBotRequest
 */
export function buildCreateBotRequest(params: BuildCreateBotRequestParams): CreateBotRequest {
  const { meetingUrl, botName, webhookUrl, transcriptionProvider, transcriptionLanguage } = params;

  // Build transcription provider configuration
  const providerConfig = transcriptionProvider === 'deepgram_streaming' ? {
    deepgram_streaming: {
      language: transcriptionLanguage,
      model: 'nova-3',
    },
  } : {
    recallai_streaming: {
      language_code: transcriptionLanguage,
    },
  };

  return {
    meeting_url: meetingUrl,
    bot_name: botName,
    chat: {
      on_bot_join: {
        send_to: 'everyone',
        message: 'AI facilitator has joined the meeting.',
      },
    },
    recording_config: {
      transcript: {
        provider: providerConfig,
      },
      realtime_endpoints: [
        {
          type: 'webhook',
          url: webhookUrl,
          events: ['transcript.data'],
        },
      ],
      retention: {
        type: 'timed',
        hours: 24,
      },
    },
    automatic_leave: {
      waiting_room_timeout: 1200, // デフォルト: 1200秒（20分）
      noone_joined_timeout: 1200, // デフォルト: 1200秒（20分）
      everyone_left_timeout: {
        timeout: 2, // 全員退出後2秒で退出
      },
      silence_detection: {
        timeout: 3600, // 60分沈黙後に退出
        activate_after: 1200, // 20分後から検知開始
      },
    },
  };
}
