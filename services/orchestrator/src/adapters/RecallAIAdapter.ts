/**
 * RecallAIAdapter
 *
 * Adapter implementation for Recall.ai integration.
 * Provides bot-based meeting participation for Zoom, Google Meet, Microsoft Teams, etc.
 *
 * Phase 2 implementation - currently a stub.
 */

import {
  MeetingServiceAdapter,
  TranscriptEvent,
  ParticipantEvent,
  MeetingInfo,
} from './MeetingServiceAdapter';

interface RecallBot {
  id: string;
  meetingUrl: string;
  status: 'starting' | 'in_meeting' | 'done' | 'error';
}

export class RecallAIAdapter implements MeetingServiceAdapter {
  private apiKey: string;
  private apiBaseUrl: string;
  private webhookUrl: string;
  private transcriptCallback: ((event: TranscriptEvent) => void) | null = null;
  private participantCallback: ((event: ParticipantEvent) => void) | null = null;
  private activeBots: Map<string, RecallBot> = new Map();

  constructor(config: {
    apiKey: string;
    apiBaseUrl?: string;
    webhookUrl: string;
  }) {
    this.apiKey = config.apiKey;
    this.apiBaseUrl = config.apiBaseUrl || 'https://us-west-2.recall.ai';
    this.webhookUrl = config.webhookUrl;
  }

  async initialize(): Promise<void> {
    console.log('RecallAIAdapter initialized');
    // TODO Phase 2: Initialize webhook server
    // TODO Phase 2: Verify API connectivity
  }

  async shutdown(): Promise<void> {
    // Leave all active meetings
    for (const [meetingId, bot] of this.activeBots.entries()) {
      try {
        await this.leave(meetingId);
      } catch (error) {
        console.error(`Failed to leave meeting ${meetingId}:`, error);
      }
    }
    this.activeBots.clear();
    console.log('RecallAIAdapter shutdown');
  }

  onTranscript(callback: (event: TranscriptEvent) => void): void {
    this.transcriptCallback = callback;
    // TODO Phase 2: Setup webhook handler for real-time transcription
  }

  onParticipantEvent(callback: (event: ParticipantEvent) => void): void {
    this.participantCallback = callback;
    // TODO Phase 2: Setup webhook handler for participant events
  }

  async join(meetingInfo: MeetingInfo): Promise<void> {
    if (!meetingInfo.recallConfig) {
      throw new Error('recallConfig is required for RecallAIAdapter');
    }

    console.log(
      JSON.stringify({
        type: 'adapter.join',
        platform: meetingInfo.platform,
        meetingId: meetingInfo.meetingId,
        meetingUrl: meetingInfo.recallConfig.meetingUrl,
      })
    );

    // TODO Phase 2: Implement bot creation
    // POST /api/v1/bot/
    // const response = await fetch(`${this.apiBaseUrl}/api/v1/bot/`, {
    //   method: 'POST',
    //   headers: {
    //     'Authorization': `Bearer ${this.apiKey}`,
    //     'Content-Type': 'application/json',
    //   },
    //   body: JSON.stringify({
    //     meeting_url: meetingInfo.recallConfig.meetingUrl,
    //     bot_name: meetingInfo.recallConfig.botName || 'Timtam AI',
    //     transcription_options: {
    //       provider: 'recall',
    //       realtime: true,
    //       partial_results: true,
    //     },
    //     chat: {
    //       on_bot_join: {
    //         send_to: 'everyone',
    //         message: meetingInfo.recallConfig.joinMessage || 'AI facilitator has joined.',
    //       },
    //     },
    //     real_time_transcription: {
    //       destination_url: `${this.webhookUrl}/recall/transcript`,
    //     },
    //   }),
    // });
    //
    // const bot = await response.json();
    // this.activeBots.set(meetingInfo.meetingId, {
    //   id: bot.id,
    //   meetingUrl: meetingInfo.recallConfig.meetingUrl,
    //   status: bot.status,
    // });

    throw new Error('RecallAIAdapter.join not yet implemented (Phase 2)');
  }

  async leave(meetingId: string): Promise<void> {
    const bot = this.activeBots.get(meetingId);
    if (!bot) {
      console.warn(`No active bot found for meeting ${meetingId}`);
      return;
    }

    console.log(
      JSON.stringify({
        type: 'adapter.leave',
        platform: 'recall',
        meetingId,
        botId: bot.id,
      })
    );

    // TODO Phase 2: Implement bot deletion
    // DELETE /api/v1/bot/{botId}/
    // await fetch(`${this.apiBaseUrl}/api/v1/bot/${bot.id}/`, {
    //   method: 'DELETE',
    //   headers: {
    //     'Authorization': `Bearer ${this.apiKey}`,
    //   },
    // });

    this.activeBots.delete(meetingId);
  }

  async sendMessage(meetingId: string, text: string): Promise<void> {
    const bot = this.activeBots.get(meetingId);
    if (!bot) {
      throw new Error(`No active bot found for meeting ${meetingId}`);
    }

    console.log(
      JSON.stringify({
        type: 'chat.post',
        meetingId,
        message: text.substring(0, 100),
        adapter: 'RecallAI',
        botId: bot.id,
      })
    );

    // TODO Phase 2: Implement chat message sending
    // POST /api/v1/bot/{botId}/send_chat_message/
    // await fetch(`${this.apiBaseUrl}/api/v1/bot/${bot.id}/send_chat_message/`, {
    //   method: 'POST',
    //   headers: {
    //     'Authorization': `Bearer ${this.apiKey}`,
    //     'Content-Type': 'application/json',
    //   },
    //   body: JSON.stringify({
    //     message: text,
    //     pin_message: false,
    //   }),
    // });

    throw new Error('RecallAIAdapter.sendMessage not yet implemented (Phase 2)');
  }

  async sendAudio(meetingId: string, audioData: Buffer): Promise<void> {
    // TODO Phase 2: Implement audio streaming via WebSocket
    // This is for future TTS integration (Phase 5)
    throw new Error('RecallAIAdapter.sendAudio not yet implemented (Phase 2)');
  }

  /**
   * Handle incoming webhook from Recall.ai
   * Called by webhook Lambda function
   */
  async handleWebhook(eventType: string, payload: any): Promise<void> {
    // TODO Phase 2: Implement webhook handling
    switch (eventType) {
      case 'bot.transcript':
        // Convert Recall.ai transcript format to TranscriptEvent
        // if (this.transcriptCallback) {
        //   this.transcriptCallback({
        //     meetingId: payload.bot_id,
        //     speakerId: payload.speaker.participant_id,
        //     text: payload.words.map((w: any) => w.text).join(' '),
        //     isFinal: !payload.is_partial,
        //     timestamp: Date.now(),
        //     sequenceNumber: payload.sequence_number,
        //   });
        // }
        break;

      case 'participant.join':
      case 'participant.leave':
        // if (this.participantCallback) {
        //   this.participantCallback({
        //     type: eventType === 'participant.join' ? 'join' : 'leave',
        //     participantId: payload.participant.id,
        //     participantName: payload.participant.name,
        //     timestamp: Date.now(),
        //   });
        // }
        break;

      default:
        console.warn(`Unknown webhook event type: ${eventType}`);
    }
  }
}
