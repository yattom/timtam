import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Meeting, MeetingConfig } from './meetingOrchestrator';
import { MeetingServiceAdapter, MeetingId } from '@timtam/shared';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

describe('Meeting - DynamoDB保存共通処理', () => {
  /**
   * postChat()がDynamoDBにメッセージを保存することを確認
   * （サービス非依存の共通処理）
   */
  it('postChat()でDynamoDBにai_interventionメッセージを保存する', async () => {
    // Arrange
    const mockSend = vi.fn().mockResolvedValue({});
    const mockDdbClient = {
      send: mockSend,
    } as any;

    const mockAdapter: MeetingServiceAdapter = {
      processInboundTranscript: vi.fn(),
      postChat: vi.fn(),
      postLlmCallLog: vi.fn(),
    };

    const config: MeetingConfig = {
      meetingId: 'test-meeting-id' as MeetingId,
      adapter: mockAdapter,
      aiMessagesTable: 'test-ai-messages-table',
      ddbClient: mockDdbClient,
    };

    const meeting = new Meeting(config, []);

    // Act
    const testMessage = 'テストメッセージ';
    await meeting.postChat(config.meetingId, testMessage);

    // Assert - DynamoDBにPutCommandが送信されたか
    expect(mockSend).toHaveBeenCalledTimes(1);

    const putCommand = mockSend.mock.calls[0][0];
    expect(putCommand.input.TableName).toBe('test-ai-messages-table');
    expect(putCommand.input.Item.meetingId).toBe('test-meeting-id');
    expect(putCommand.input.Item.message).toBe(testMessage);
    expect(putCommand.input.Item.type).toBe('ai_intervention');
    expect(putCommand.input.Item).toHaveProperty('timestamp');
    expect(putCommand.input.Item).toHaveProperty('ttl');

    // adapter.postChat()も呼ばれたか
    expect(mockAdapter.postChat).toHaveBeenCalledWith(config.meetingId, testMessage);
  });

  /**
   * DynamoDB保存が失敗してもadapter.postChat()は呼ばれることを確認
   * （エラーハンドリング）
   */
  it('DynamoDB保存に失敗してもエラーを投げずadapter.postChat()を呼ぶ', async () => {
    // Arrange
    const mockSend = vi.fn().mockRejectedValue(new Error('DynamoDB error'));
    const mockDdbClient = {
      send: mockSend,
    } as any;

    const mockAdapter: MeetingServiceAdapter = {
      processInboundTranscript: vi.fn(),
      postChat: vi.fn(),
      postLlmCallLog: vi.fn(),
    };

    const config: MeetingConfig = {
      meetingId: 'test-meeting-id' as MeetingId,
      adapter: mockAdapter,
      aiMessagesTable: 'test-ai-messages-table',
      ddbClient: mockDdbClient,
    };

    const meeting = new Meeting(config, []);

    // Act & Assert - エラーを投げないこと
    await expect(
      meeting.postChat(config.meetingId, 'test message')
    ).resolves.not.toThrow();

    // DynamoDBへの保存が試みられたこと
    expect(mockSend).toHaveBeenCalledTimes(1);

    // adapter.postChat()は呼ばれること
    expect(mockAdapter.postChat).toHaveBeenCalledWith(config.meetingId, 'test message');
  });

  /**
   * aiMessagesTableが設定されていない場合、DynamoDB保存をスキップすることを確認
   */
  it('aiMessagesTableが設定されていない場合はDynamoDB保存をスキップする', async () => {
    // Arrange
    const mockSend = vi.fn();
    const mockDdbClient = {
      send: mockSend,
    } as any;

    const mockAdapter: MeetingServiceAdapter = {
      processInboundTranscript: vi.fn(),
      postChat: vi.fn(),
      postLlmCallLog: vi.fn(),
    };

    const config: MeetingConfig = {
      meetingId: 'test-meeting-id' as MeetingId,
      adapter: mockAdapter,
      // aiMessagesTableを設定しない
    };

    const meeting = new Meeting(config, []);

    // Act
    await meeting.postChat(config.meetingId, 'test message');

    // Assert - DynamoDBへの保存は試みられないこと
    expect(mockSend).not.toHaveBeenCalled();

    // adapter.postChat()は呼ばれること
    expect(mockAdapter.postChat).toHaveBeenCalledWith(config.meetingId, 'test message');
  });
});
