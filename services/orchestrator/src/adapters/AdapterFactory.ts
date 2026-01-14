/**
 * AdapterFactory
 *
 * Factory for creating the appropriate MeetingServiceAdapter
 * based on platform configuration.
 */

import { MeetingServiceAdapter } from './MeetingServiceAdapter';
import { ChimeSDKAdapter } from './ChimeSDKAdapter';
import { RecallAIAdapter } from './RecallAIAdapter';

export type AdapterPlatform = 'chime' | 'recall';

export interface AdapterConfig {
  platform: AdapterPlatform;

  // Chime SDK configuration
  chime?: {
    transcriptQueueUrl: string;
    aiMessagesTable: string;
  };

  // Recall.ai configuration
  recall?: {
    apiKey: string;
    apiBaseUrl?: string;
    webhookUrl: string;
  };
}

/**
 * Create a MeetingServiceAdapter based on platform configuration
 */
export function createAdapter(config: AdapterConfig): MeetingServiceAdapter {
  switch (config.platform) {
    case 'chime':
      if (!config.chime) {
        throw new Error('Chime configuration is required for platform "chime"');
      }
      return new ChimeSDKAdapter({
        transcriptQueueUrl: config.chime.transcriptQueueUrl,
        aiMessagesTable: config.chime.aiMessagesTable,
      });

    case 'recall':
      if (!config.recall) {
        throw new Error('Recall.ai configuration is required for platform "recall"');
      }
      return new RecallAIAdapter({
        apiKey: config.recall.apiKey,
        apiBaseUrl: config.recall.apiBaseUrl,
        webhookUrl: config.recall.webhookUrl,
      });

    default:
      throw new Error(`Unsupported platform: ${config.platform}`);
  }
}

/**
 * Create adapter from environment variables
 * Defaults to Chime SDK for backward compatibility
 */
export function createAdapterFromEnv(): MeetingServiceAdapter {
  const platform = (process.env.MEETING_PLATFORM || 'chime') as AdapterPlatform;

  const config: AdapterConfig = {
    platform,
  };

  if (platform === 'chime') {
    config.chime = {
      transcriptQueueUrl: process.env.TRANSCRIPT_QUEUE_URL || '',
      aiMessagesTable: process.env.AI_MESSAGES_TABLE || 'timtam-ai-messages',
    };
  } else if (platform === 'recall') {
    config.recall = {
      apiKey: process.env.RECALL_API_KEY || '',
      apiBaseUrl: process.env.RECALL_API_BASE_URL,
      webhookUrl: process.env.RECALL_WEBHOOK_URL || '',
    };
  }

  return createAdapter(config);
}
