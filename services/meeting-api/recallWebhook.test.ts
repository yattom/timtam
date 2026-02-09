import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { handler } from './recallWebhook';
import { APIGatewayProxyEventV2 } from 'aws-lambda';

const ddbMock = mockClient(DynamoDBDocumentClient);
const sqsMock = mockClient(SQSClient);

describe('recallWebhook - bot.status event handling', () => {
  beforeEach(() => {
    ddbMock.reset();
    sqsMock.reset();
  });

  describe('bot.status: done', () => {
    it('ミーティングステータスをendedに更新し、TTLを設定すること', async () => {
      const botId = 'bot-12345';
      const now = Date.now();
      const expectedTtl = Math.floor(now / 1000) + (7 * 24 * 60 * 60);

      // Mock DynamoDB GetCommand (ミーティング存在確認)
      ddbMock.on(GetCommand).resolves({
        Item: {
          meetingId: botId,
          platform: 'recall',
          status: 'active',
          recallBot: {
            botId,
            meetingUrl: 'https://zoom.us/j/123',
            platform: 'zoom',
            status: 'in_meeting',
          },
        },
      });

      // Mock DynamoDB UpdateCommand
      ddbMock.on(UpdateCommand).resolves({});

      const event = {
        body: JSON.stringify({
          event: 'bot.status',
          bot_id: botId,
          status: 'done',
        }),
      } as APIGatewayProxyEventV2;

      const response = await handler(event);

      expect(response.statusCode).toBe(200);

      // UpdateCommand が呼ばれたことを確認
      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      expect(updateCalls.length).toBe(1);

      const updateInput = updateCalls[0].args[0].input;
      expect(updateInput.Key).toEqual({ meetingId: botId });
      expect(updateInput.UpdateExpression).toContain('status');
      expect(updateInput.UpdateExpression).toContain('endedAt');
      expect(updateInput.UpdateExpression).toContain('ttl');
      expect(updateInput.ExpressionAttributeValues?.[':status']).toBe('ended');
      expect(updateInput.ExpressionAttributeValues?.[':endedAt']).toBeGreaterThan(now - 1000);

      // TTLが7日後に設定されていることを確認（±10秒の誤差を許容）
      const actualTtl = updateInput.ExpressionAttributeValues?.[':ttl'] as number;
      expect(actualTtl).toBeGreaterThanOrEqual(expectedTtl - 10);
      expect(actualTtl).toBeLessThanOrEqual(expectedTtl + 10);
    });
  });

  describe('bot.status: error', () => {
    it('エラー状態でもミーティングステータスをendedに更新すること', async () => {
      const botId = 'bot-error-123';

      ddbMock.on(GetCommand).resolves({
        Item: {
          meetingId: botId,
          platform: 'recall',
          status: 'active',
        },
      });

      ddbMock.on(UpdateCommand).resolves({});

      const event = {
        body: JSON.stringify({
          event: 'bot.status',
          bot_id: botId,
          status: 'error',
          status_message: 'Failed to join meeting',
        }),
      } as APIGatewayProxyEventV2;

      const response = await handler(event);

      expect(response.statusCode).toBe(200);

      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      expect(updateCalls.length).toBe(1);
      expect(updateCalls[0].args[0].input.ExpressionAttributeValues?.[':status']).toBe('ended');
    });
  });

  describe('bot.status: in_meeting', () => {
    it('in_meeting状態ではDynamoDBを更新しないこと', async () => {
      const event = {
        body: JSON.stringify({
          event: 'bot.status',
          bot_id: 'bot-123',
          status: 'in_meeting',
        }),
      } as APIGatewayProxyEventV2;

      const response = await handler(event);

      expect(response.statusCode).toBe(200);

      // UpdateCommand が呼ばれていないことを確認
      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      expect(updateCalls.length).toBe(0);
    });
  });

  describe('bot.status: ready', () => {
    it('ready状態ではDynamoDBを更新しないこと', async () => {
      const event = {
        body: JSON.stringify({
          event: 'bot.status',
          bot_id: 'bot-123',
          status: 'ready',
        }),
      } as APIGatewayProxyEventV2;

      const response = await handler(event);

      expect(response.statusCode).toBe(200);

      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      expect(updateCalls.length).toBe(0);
    });
  });

  describe('DynamoDBエラーハンドリング', () => {
    it('DynamoDB更新が失敗してもHTTP 200を返すこと', async () => {
      const botId = 'bot-456';

      ddbMock.on(GetCommand).resolves({
        Item: {
          meetingId: botId,
          platform: 'recall',
          status: 'active',
        },
      });

      // UpdateCommandでエラーを発生させる
      ddbMock.on(UpdateCommand).rejects(new Error('DynamoDB update failed'));

      const event = {
        body: JSON.stringify({
          event: 'bot.status',
          bot_id: botId,
          status: 'done',
        }),
      } as APIGatewayProxyEventV2;

      const response = await handler(event);

      // Webhookは常に200を返す（Recall.aiのリトライを防ぐため）
      expect(response.statusCode).toBe(200);
    });
  });

  describe('既存のtranscript.data処理', () => {
    it('transcript.dataイベントは既存通りSQSに送信されること', async () => {
      sqsMock.on(SendMessageCommand).resolves({});

      const event = {
        body: JSON.stringify({
          event: 'transcript.data',
          data: {
            bot: { id: 'bot-123' },
            transcript: { id: 'transcript-1' },
            data: {
              participant: { id: 'participant-1', name: 'Test User' },
              words: [
                { text: 'Hello', start_timestamp: { relative: 1000 } },
              ],
            },
          },
        }),
      } as APIGatewayProxyEventV2;

      const response = await handler(event);

      expect(response.statusCode).toBe(200);

      // SQS SendMessageCommand が呼ばれたことを確認
      const sqsCalls = sqsMock.commandCalls(SendMessageCommand);
      expect(sqsCalls.length).toBe(1);
    });
  });
});
