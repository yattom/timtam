import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { handler } from './recallWebhook';
import { APIGatewayProxyEventV2 } from 'aws-lambda';

const ddbMock = mockClient(DynamoDBDocumentClient);
const sqsMock = mockClient(SQSClient);

function makeBotStatusEvent(eventType: string, botId: string, code: string, subCode: string | null = null) {
  return {
    body: JSON.stringify({
      event: eventType,
      data: {
        bot: { id: botId, metadata: {} },
        data: {
          code,
          sub_code: subCode,
          updated_at: '2026-02-22T01:44:45.000Z',
        },
      },
    }),
  } as APIGatewayProxyEventV2;
}

describe('recallWebhook - bot status event handling', () => {
  beforeEach(() => {
    ddbMock.reset();
    sqsMock.reset();
  });

  describe('bot.call_ended', () => {
    it('ミーティングステータスをendedに更新し、TTLを設定すること', async () => {
      const botId = 'bot-12345';
      const now = Date.now();
      const expectedTtl = Math.floor(now / 1000) + (7 * 24 * 60 * 60);

      ddbMock.on(UpdateCommand).resolves({});

      const event = makeBotStatusEvent('bot.call_ended', botId, 'call_ended', 'call_ended_by_host');

      const response = await handler(event);

      expect(response.statusCode).toBe(200);

      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      expect(updateCalls.length).toBe(1);

      const updateInput = updateCalls[0].args[0].input;
      expect(updateInput.Key).toEqual({ meetingId: botId });
      expect(updateInput.UpdateExpression).toContain('status');
      expect(updateInput.UpdateExpression).toContain('endedAt');
      expect(updateInput.UpdateExpression).toContain('ttl');
      expect(updateInput.ConditionExpression).toBe('attribute_exists(meetingId)');
      expect(updateInput.ExpressionAttributeValues?.[':status']).toBe('ended');
      expect(updateInput.ExpressionAttributeValues?.[':endedAt']).toBeGreaterThan(now - 1000);

      const actualTtl = updateInput.ExpressionAttributeValues?.[':ttl'] as number;
      expect(actualTtl).toBeGreaterThanOrEqual(expectedTtl - 10);
      expect(actualTtl).toBeLessThanOrEqual(expectedTtl + 10);
    });
  });

  describe('bot.done', () => {
    it('ミーティングステータスをendedに更新すること', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      const event = makeBotStatusEvent('bot.done', 'bot-done-123', 'done');

      const response = await handler(event);

      expect(response.statusCode).toBe(200);

      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      expect(updateCalls.length).toBe(1);
      expect(updateCalls[0].args[0].input.ExpressionAttributeValues?.[':status']).toBe('ended');
    });
  });

  describe('bot.fatal', () => {
    it('エラー状態でもミーティングステータスをendedに更新すること', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      const event = makeBotStatusEvent('bot.fatal', 'bot-fatal-123', 'fatal', 'bot_errored');

      const response = await handler(event);

      expect(response.statusCode).toBe(200);

      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      expect(updateCalls.length).toBe(1);
      expect(updateCalls[0].args[0].input.ExpressionAttributeValues?.[':status']).toBe('ended');
    });
  });

  describe('bot.joining_call', () => {
    it('非終了状態ではDynamoDBを更新しないこと', async () => {
      const event = makeBotStatusEvent('bot.joining_call', 'bot-123', 'joining_call');

      const response = await handler(event);

      expect(response.statusCode).toBe(200);

      const updateCalls = ddbMock.commandCalls(UpdateCommand);
      expect(updateCalls.length).toBe(0);
    });
  });

  describe('DynamoDBエラーハンドリング', () => {
    it('ミーティングが存在しない場合でもHTTP 200を返すこと', async () => {
      const conditionalCheckError = new Error('The conditional request failed');
      conditionalCheckError.name = 'ConditionalCheckFailedException';
      ddbMock.on(UpdateCommand).rejects(conditionalCheckError);

      const event = makeBotStatusEvent('bot.call_ended', 'bot-not-found', 'call_ended');

      const response = await handler(event);

      expect(response.statusCode).toBe(200);
    });

    it('DynamoDB更新が失敗してもHTTP 200を返すこと', async () => {
      ddbMock.on(UpdateCommand).rejects(new Error('DynamoDB update failed'));

      const event = makeBotStatusEvent('bot.call_ended', 'bot-456', 'call_ended');

      const response = await handler(event);

      expect(response.statusCode).toBe(200);
    });
  });

  describe('participant_events.chat_message', () => {
    it('チャットメッセージをSQSに送信すること', async () => {
      sqsMock.on(SendMessageCommand).resolves({});

      const event = {
        body: JSON.stringify({
          event: 'participant_events.chat_message',
          data: {
            bot: { id: 'bot-123' },
            data: {
              participant: { id: 'participant-1', name: 'Alice' },
              timestamp: { absolute: '2026-04-10T10:00:00.000Z' },
              data: { text: 'こんにちは', to: 'everyone' },
            },
          },
        }),
      } as APIGatewayProxyEventV2;

      const response = await handler(event);

      expect(response.statusCode).toBe(200);
      const sqsCalls = sqsMock.commandCalls(SendMessageCommand);
      expect(sqsCalls.length).toBe(1);

      const body = JSON.parse(sqsCalls[0].args[0].input.MessageBody!);
      expect(body.meetingId).toBe('bot-123');
      expect(body.speakerId).toBe('Alice');
      expect(body.text).toBe('こんにちは');
      expect(body.source).toBe('chat');
      expect(body.isFinal).toBe(true);
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

      const sqsCalls = sqsMock.commandCalls(SendMessageCommand);
      expect(sqsCalls.length).toBe(1);
    });
  });
});
