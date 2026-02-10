import { describe, it, expect, vi } from 'vitest';
import { Meeting, MeetingConfig } from './meetingOrchestrator';
import { MeetingServiceAdapter, MeetingId, TranscriptEvent } from '@timtam/shared';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Grasp, LLMClient, Metrics, JudgeResult } from './grasp';

describe('Meeting - processTranscriptEvent', () => {
  const nullAdapter = (): MeetingServiceAdapter => ({
    processInboundTranscript: vi.fn(),
    postChat: vi.fn(async () => {}),
    postLlmCallLog: vi.fn(async () => {}),
  });
  const nullMetrics = (): Metrics => ({
    putLatencyMetric: vi.fn(async () => {}),
    putCountMetric: vi.fn(async () => {}),
  });
  const makeEvent = (text: string): TranscriptEvent => ({
    meetingId: 'test-meeting' as MeetingId,
    speakerId: 'speaker1',
    text,
    isFinal: true,
    timestamp: Date.now(),
  });

  it('reproducing issue #173 - should not execute the same grasp twice when two events arrive during one LLM call', async () => {
    // Arrange
    const llmIsInvoked: LLMClient = { invoke: vi.fn().mockResolvedValue({} as any) };

    const grasp = new Grasp(
      { nodeId: 'test', promptTemplate: 'テスト', cooldownMs: 60000, outputHandler: 'chat' },
      llmIsInvoked
    );
    const meeting = new Meeting(
      { meetingId: 'test-meeting' as MeetingId, adapter: nullAdapter() },
      [grasp]
    );

    // Act
    // First event - grasp is enqueued and execute() starts (yields at LLM call)
    const firstProcessing = meeting.processTranscriptEvent(makeEvent('発言1'), nullMetrics());

    // Second event arrives while first LLM call is in flight:
    // - shouldExecute() is still true (markExecuted not called yet)
    // - grasp is re-enqueued (not in queue - was shifted out by first processNext)
    // - processNext() global cooldown also not updated yet
    const secondProcessing = meeting.processTranscriptEvent(makeEvent('発言2'), nullMetrics());

    await firstProcessing;
    await secondProcessing;

    // Assert
    // Should only have been executed once - FAILS with current code (called 2 times)
    expect(llmIsInvoked.invoke).toHaveBeenCalledTimes(1);
  });
});

describe('Meeting - DynamoDB保存共通処理', () => {
  /**
   * postChat()がDynamoDBにメッセージを保存することを確認
   * （サービス非依存の共通処理）
   */
  it('postChat()でDynamoDBにai_interventionメッセージを保存する', async () => {
    // Arrange
    const mockSend = vi.fn().mockResolvedValue({});
    const mockDocClient = {
      send: mockSend,
    } as any;

    // Mock DynamoDBDocumentClient.from to return our mock
    vi.spyOn(DynamoDBDocumentClient, 'from').mockReturnValue(mockDocClient);

    const mockDdbClient = {} as any;

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
    const mockDocClient = {
      send: mockSend,
    } as any;

    // Mock DynamoDBDocumentClient.from to return our mock
    vi.spyOn(DynamoDBDocumentClient, 'from').mockReturnValue(mockDocClient);

    const mockDdbClient = {} as any;

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
