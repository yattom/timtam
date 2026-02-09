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
  };
}
