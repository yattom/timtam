/**
 * RecallNotifier
 *
 * Implementation of Notifier for Recall.ai.
 * Sends messages via Recall.ai Chat API.
 */

import { Notifier, MeetingId } from '../../grasp';
import { RecallAPIClient } from '../recall/RecallAPIClient';

interface RecallBotMapping {
  botId: string;
  meetingUrl: string;
}

export class RecallNotifier implements Notifier {
  private apiClient: RecallAPIClient;
  private botMappings: Map<string, RecallBotMapping> = new Map();

  constructor(config: { apiKey: string; apiBaseUrl?: string }) {
    this.apiClient = new RecallAPIClient(
      config.apiKey,
      config.apiBaseUrl || 'https://us-west-2.recall.ai'
    );
  }

  /**
   * Register a bot ID for a meeting
   * Called when a bot joins a meeting
   */
  registerBot(meetingId: MeetingId, botId: string, meetingUrl: string): void {
    this.botMappings.set(meetingId, { botId, meetingUrl });
    console.log(
      JSON.stringify({
        type: 'recall.bot.registered',
        meetingId,
        botId,
        meetingUrl,
        timestamp: Date.now(),
      })
    );
  }

  /**
   * Unregister a bot ID
   * Called when a bot leaves a meeting
   */
  unregisterBot(meetingId: MeetingId): void {
    this.botMappings.delete(meetingId);
    console.log(
      JSON.stringify({
        type: 'recall.bot.unregistered',
        meetingId,
        timestamp: Date.now(),
      })
    );
  }

  /**
   * Get bot ID for a meeting
   */
  getBotId(meetingId: MeetingId): string | undefined {
    return this.botMappings.get(meetingId)?.botId;
  }

  async postChat(meetingId: MeetingId, message: string): Promise<void> {
    const bot = this.botMappings.get(meetingId);
    if (!bot) {
      console.warn(`No bot mapping found for meeting ${meetingId}`);
      throw new Error(`No bot registered for meeting ${meetingId}`);
    }

    try {
      await this.apiClient.sendChatMessage(bot.botId, message, false);

      console.log(
        JSON.stringify({
          type: 'chat.post',
          meetingId,
          message: message.substring(0, 100),
          platform: 'recall',
          botId: bot.botId,
          timestamp: Date.now(),
        })
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          type: 'chat.post.error',
          meetingId,
          botId: bot.botId,
          error: (error as Error).message,
          timestamp: Date.now(),
        })
      );
      throw error;
    }
  }

  async postLlmCallLog(
    meetingId: MeetingId,
    prompt: string,
    rawResponse: string,
    nodeId: string = 'default'
  ): Promise<void> {
    // For Recall.ai, we log to CloudWatch
    // Could optionally store in DynamoDB or send to external logging service
    console.log(
      JSON.stringify({
        type: 'llm_call.logged',
        meetingId,
        nodeId,
        promptLength: prompt.length,
        responseLength: rawResponse.length,
        timestamp: Date.now(),
        platform: 'recall',
      })
    );
  }
}
