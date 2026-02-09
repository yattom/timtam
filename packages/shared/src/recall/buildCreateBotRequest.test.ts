import { describe, it, expect } from 'vitest';
import { buildCreateBotRequest } from './buildCreateBotRequest';

describe('buildCreateBotRequest', () => {
  it('recording_config.retentionを24時間に設定すること', () => {
    const request = buildCreateBotRequest({
      meetingUrl: 'https://zoom.us/j/123456789',
      botName: 'Test Bot',
      webhookUrl: 'https://example.com/webhook',
      transcriptionProvider: 'deepgram_streaming',
      transcriptionLanguage: 'auto',
    });

    expect(request.recording_config?.retention).toEqual({ hours: 24 });
  });

  it('Deepgram Streamingプロバイダーを正しく設定すること', () => {
    const request = buildCreateBotRequest({
      meetingUrl: 'https://zoom.us/j/123456789',
      botName: 'Test Bot',
      webhookUrl: 'https://example.com/webhook',
      transcriptionProvider: 'deepgram_streaming',
      transcriptionLanguage: 'ja',
    });

    expect(request.recording_config?.transcript?.provider?.deepgram_streaming).toEqual({
      language: 'ja',
      model: 'nova-3',
    });
  });

  it('Recall.ai Streamingプロバイダーを正しく設定すること', () => {
    const request = buildCreateBotRequest({
      meetingUrl: 'https://zoom.us/j/123456789',
      botName: 'Test Bot',
      webhookUrl: 'https://example.com/webhook',
      transcriptionProvider: 'recallai_streaming',
      transcriptionLanguage: 'ja',
    });

    expect(request.recording_config?.transcript?.provider?.recallai_streaming).toEqual({
      language_code: 'ja',
    });
  });

  it('リアルタイムエンドポイントを正しく設定すること', () => {
    const request = buildCreateBotRequest({
      meetingUrl: 'https://zoom.us/j/123456789',
      botName: 'Test Bot',
      webhookUrl: 'https://example.com/webhook',
      transcriptionProvider: 'deepgram_streaming',
      transcriptionLanguage: 'auto',
    });

    expect(request.recording_config?.realtime_endpoints).toEqual([
      {
        type: 'webhook',
        url: 'https://example.com/webhook',
        events: ['transcript.data'],
      },
    ]);
  });

  it('ボット名と会議URLを正しく設定すること', () => {
    const request = buildCreateBotRequest({
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      botName: 'My Custom Bot',
      webhookUrl: 'https://example.com/webhook',
      transcriptionProvider: 'deepgram_streaming',
      transcriptionLanguage: 'auto',
    });

    expect(request.meeting_url).toBe('https://meet.google.com/abc-defg-hij');
    expect(request.bot_name).toBe('My Custom Bot');
  });

  it('チャット設定を正しく設定すること', () => {
    const request = buildCreateBotRequest({
      meetingUrl: 'https://zoom.us/j/123456789',
      botName: 'Test Bot',
      webhookUrl: 'https://example.com/webhook',
      transcriptionProvider: 'deepgram_streaming',
      transcriptionLanguage: 'auto',
    });

    expect(request.chat).toEqual({
      on_bot_join: {
        send_to: 'everyone',
        message: 'AI facilitator has joined the meeting.',
      },
    });
  });

  it('automatic_leave設定を正しく設定すること', () => {
    const request = buildCreateBotRequest({
      meetingUrl: 'https://zoom.us/j/123456789',
      botName: 'Test Bot',
      webhookUrl: 'https://example.com/webhook',
      transcriptionProvider: 'deepgram_streaming',
      transcriptionLanguage: 'auto',
    });

    expect(request.automatic_leave).toEqual({
      waiting_room_timeout: 1200,
      noone_joined_timeout: 1200,
      everyone_left_timeout: {
        timeout: 2,
      },
      silence_detection: {
        timeout: 3600,
        activate_after: 1200,
      },
    });
  });
});
