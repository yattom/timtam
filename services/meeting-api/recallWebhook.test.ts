import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { handler } from './recallWebhook';
import { APIGatewayProxyEventV2 } from 'aws-lambda';

const sqsMock = mockClient(SQSClient);

describe('recallWebhook - bot.statusイベント処理', () => {
  beforeEach(() => {
    sqsMock.reset();
  });

  it('bot.status: done - meeting.endedイベントをSQSに送信すること', async () => {
    sqsMock.on(SendMessageCommand).resolves({});

    const event = {
      body: JSON.stringify({
        event: 'bot.status',
        bot_id: 'test-bot-123',
        status: 'done',
      }),
    } as APIGatewayProxyEventV2;

    const response = await handler(event);

    expect(response.statusCode).toBe(200);

    // SQSにメッセージが送信されたことを確認
    const calls = sqsMock.commandCalls(SendMessageCommand);
    expect(calls.length).toBe(1);

    const sentMessage = JSON.parse(calls[0].args[0].input.MessageBody as string);
    expect(sentMessage.type).toBe('meeting.ended');
    expect(sentMessage.meetingId).toBe('test-bot-123');
    expect(sentMessage.reason).toBe('bot.status.done');
    expect(sentMessage.timestamp).toBeDefined();

    // MessageGroupIdが設定されていることを確認
    expect(calls[0].args[0].input.MessageGroupId).toBe('test-bot-123');
  });

  it('bot.status: error - meeting.endedイベントをSQSに送信すること', async () => {
    sqsMock.on(SendMessageCommand).resolves({});

    const event = {
      body: JSON.stringify({
        event: 'bot.status',
        bot_id: 'test-bot-456',
        status: 'error',
      }),
    } as APIGatewayProxyEventV2;

    const response = await handler(event);

    expect(response.statusCode).toBe(200);

    const calls = sqsMock.commandCalls(SendMessageCommand);
    expect(calls.length).toBe(1);

    const sentMessage = JSON.parse(calls[0].args[0].input.MessageBody as string);
    expect(sentMessage.type).toBe('meeting.ended');
    expect(sentMessage.meetingId).toBe('test-bot-456');
    expect(sentMessage.reason).toBe('bot.status.error');
  });

  it('bot.status: fatal - meeting.endedイベントをSQSに送信すること', async () => {
    sqsMock.on(SendMessageCommand).resolves({});

    const event = {
      body: JSON.stringify({
        event: 'bot.status',
        bot_id: 'test-bot-789',
        status: 'fatal',
      }),
    } as APIGatewayProxyEventV2;

    const response = await handler(event);

    expect(response.statusCode).toBe(200);

    const calls = sqsMock.commandCalls(SendMessageCommand);
    expect(calls.length).toBe(1);

    const sentMessage = JSON.parse(calls[0].args[0].input.MessageBody as string);
    expect(sentMessage.type).toBe('meeting.ended');
    expect(sentMessage.meetingId).toBe('test-bot-789');
    expect(sentMessage.reason).toBe('bot.status.fatal');
  });

  it('bot.status: in_meeting - SQSにメッセージを送信しないこと', async () => {
    sqsMock.on(SendMessageCommand).resolves({});

    const event = {
      body: JSON.stringify({
        event: 'bot.status',
        bot_id: 'test-bot-active',
        status: 'in_meeting',
      }),
    } as APIGatewayProxyEventV2;

    const response = await handler(event);

    expect(response.statusCode).toBe(200);

    // SQSにメッセージが送信されていないことを確認
    const calls = sqsMock.commandCalls(SendMessageCommand);
    expect(calls.length).toBe(0);
  });

  it('bot.status: ready - SQSにメッセージを送信しないこと', async () => {
    sqsMock.on(SendMessageCommand).resolves({});

    const event = {
      body: JSON.stringify({
        event: 'bot.status',
        bot_id: 'test-bot-ready',
        status: 'ready',
      }),
    } as APIGatewayProxyEventV2;

    const response = await handler(event);

    expect(response.statusCode).toBe(200);

    // SQSにメッセージが送信されていないことを確認
    const calls = sqsMock.commandCalls(SendMessageCommand);
    expect(calls.length).toBe(0);
  });

  it('SQSエラー時も200を返すこと（Recall.aiのリトライを防ぐため）', async () => {
    sqsMock.on(SendMessageCommand).rejects(new Error('SQS send failed'));

    const event = {
      body: JSON.stringify({
        event: 'bot.status',
        bot_id: 'test-bot-error',
        status: 'done',
      }),
    } as APIGatewayProxyEventV2;

    const response = await handler(event);

    expect(response.statusCode).toBe(200);
  });
});
