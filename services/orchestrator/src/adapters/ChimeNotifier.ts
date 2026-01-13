/**
 * ChimeNotifier
 *
 * Implementation of MessageNotifier for Amazon Chime SDK.
 * Writes messages to DynamoDB for the browser to poll.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Notifier, MeetingId } from '../../grasp';

export class ChimeNotifier implements Notifier {
  private ddb: DynamoDBDocumentClient;
  private aiMessagesTable: string;

  constructor(aiMessagesTable: string) {
    const ddbClient = new DynamoDBClient({});
    this.ddb = DynamoDBDocumentClient.from(ddbClient);
    this.aiMessagesTable = aiMessagesTable;
  }

  async postChat(meetingId: MeetingId, message: string): Promise<void> {
    const timestamp = Date.now();
    const ttl = Math.floor(timestamp / 1000) + 86400; // Expire after 24 hours

    try {
      await this.ddb.send(
        new PutCommand({
          TableName: this.aiMessagesTable,
          Item: {
            meetingId,
            timestamp,
            message,
            ttl,
            type: 'ai_intervention',
          },
        })
      );
      console.log(
        JSON.stringify({
          type: 'chat.post',
          meetingId,
          message: message.substring(0, 100),
          timestamp,
          stored: 'dynamodb',
          platform: 'chime',
        })
      );
    } catch (err: any) {
      console.error('Failed to store AI message', {
        error: err?.message || err,
        meetingId,
      });
      // Fallback: log to CloudWatch
      console.log(JSON.stringify({ type: 'chat.post', meetingId, message, ts: timestamp }));
      throw err;
    }
  }

  async postLlmCallLog(
    meetingId: MeetingId,
    prompt: string,
    rawResponse: string,
    nodeId: string = 'default'
  ): Promise<void> {
    const timestamp = Date.now();
    const ttl = Math.floor(timestamp / 1000) + 86400; // Expire after 24 hours

    const logData = {
      nodeId,
      prompt,
      rawResponse,
      timestamp,
    };

    try {
      await this.ddb.send(
        new PutCommand({
          TableName: this.aiMessagesTable,
          Item: {
            meetingId,
            timestamp,
            message: JSON.stringify(logData),
            ttl,
            type: 'llm_call',
          },
        })
      );
      console.log(
        JSON.stringify({
          type: 'llm_call.logged',
          meetingId,
          nodeId,
          promptLength: prompt.length,
          responseLength: rawResponse.length,
          timestamp,
        })
      );
    } catch (err: any) {
      console.error('Failed to store LLM call log', {
        error: err?.message || err,
        meetingId,
        nodeId,
      });
    }
  }
}
