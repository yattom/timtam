/**
 * ChimeSDKAdapter
 *
 * Adapter implementation for Amazon Chime SDK integration.
 * Wraps existing DynamoDB notification logic.
 * Note: Transcript polling remains in worker.ts for now.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import {
  MeetingServiceAdapter,
  TranscriptEvent,
  ParticipantEvent,
  MeetingInfo,
} from './MeetingServiceAdapter';

export class ChimeSDKAdapter implements MeetingServiceAdapter {
  private ddb: DynamoDBDocumentClient;
  private aiMessagesTable: string;
  private transcriptCallback: ((event: TranscriptEvent) => void) | null = null;
  private participantCallback: ((event: ParticipantEvent) => void) | null = null;

  constructor(config: {
    aiMessagesTable: string;
  }) {
    const ddbClient = new DynamoDBClient({});
    this.ddb = DynamoDBDocumentClient.from(ddbClient);
    this.aiMessagesTable = config.aiMessagesTable;
  }

  async initialize(): Promise<void> {
    console.log('ChimeSDKAdapter initialized');
  }

  async shutdown(): Promise<void> {
    console.log('ChimeSDKAdapter shutdown');
  }

  onTranscript(callback: (event: TranscriptEvent) => void): void {
    this.transcriptCallback = callback;
    // Note: worker.ts will call processTranscriptEvent() directly
  }

  onParticipantEvent(callback: (event: ParticipantEvent) => void): void {
    this.participantCallback = callback;
    // Note: Chime SDK doesn't provide participant events through SQS
    // This would need to be implemented separately if needed
  }

  /**
   * Process a transcript event from SQS
   * Called by worker.ts after polling
   */
  processTranscriptEvent(event: TranscriptEvent): void {
    if (this.transcriptCallback) {
      this.transcriptCallback(event);
    }
  }

  async sendMessage(meetingId: string, text: string): Promise<void> {
    const timestamp = Date.now();
    const ttl = Math.floor(timestamp / 1000) + 86400; // Expire after 24 hours

    try {
      await this.ddb.send(
        new PutCommand({
          TableName: this.aiMessagesTable,
          Item: {
            meetingId,
            timestamp,
            message: text,
            ttl,
            type: 'ai_intervention',
          },
        })
      );
      console.log(
        JSON.stringify({
          type: 'chat.post',
          meetingId,
          message: text.substring(0, 100),
          timestamp,
          stored: 'dynamodb',
          adapter: 'ChimeSDK',
        })
      );
    } catch (error) {
      console.error('Failed to store AI message:', error);
      throw error;
    }
  }

  async sendAudio(meetingId: string, audioData: Buffer): Promise<void> {
    // TODO: Implement audio sending for Chime SDK
    // This would require integration with the existing /tts endpoint
    console.warn('ChimeSDKAdapter.sendAudio not yet implemented');
    throw new Error('sendAudio not yet implemented for ChimeSDKAdapter');
  }

  async join(meetingInfo: MeetingInfo): Promise<void> {
    // Chime SDK meetings are created through the Lambda API
    // This adapter doesn't handle meeting creation, only transcript processing
    // The browser client handles joining via ChimeSDK
    console.log(
      JSON.stringify({
        type: 'adapter.join',
        platform: 'chime',
        meetingId: meetingInfo.meetingId,
      })
    );
  }

  async leave(meetingId: string): Promise<void> {
    // Chime SDK meetings are managed by the browser client
    // This adapter doesn't handle meeting lifecycle
    console.log(
      JSON.stringify({
        type: 'adapter.leave',
        platform: 'chime',
        meetingId,
      })
    );
  }
}
