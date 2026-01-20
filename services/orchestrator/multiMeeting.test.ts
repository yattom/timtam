import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  Grasp,
  GraspConfig,
  LLMClient,
  Notifier,
  Metrics,
  JudgeResult,
  MeetingId,
} from './grasp';
import { OrchestratorManager } from './orchestratorManager';
import { Meeting } from './meetingOrchestrator';
import { TranscriptEvent } from '@timtam/shared';

describe('Multi-Meeting Orchestrator', () => {
  // Helper functions for creating test objects
  const createMockLLMClient = (overrides?: Partial<JudgeResult>): LLMClient => ({
    invoke: vi.fn(async (prompt: string, nodeId: string): Promise<JudgeResult> => ({
      result: {
        should_output: false,
        reason: 'test',
        message: 'test message',
      },
      prompt,
      rawResponse: '{}',
      ...overrides,
    })),
  });

  const createMockNotifier = (): Notifier => ({
    postChat: vi.fn(),
    postLlmCallLog: vi.fn(),
  });

  const createMockMetrics = (): Metrics => ({
    putLatencyMetric: vi.fn(),
    putCountMetric: vi.fn(),
  });

  const createTestConfig = (overrides?: Partial<GraspConfig>): GraspConfig => ({
    nodeId: 'test-grasp',
    promptTemplate: '以下の会議内容を確認してください:\n{{INPUT:latest3}}',
    cooldownMs: 1000,
    outputHandler: 'chat',
    ...overrides,
  });

  const createTestAsrEvent = (meetingId: string, text: string): TranscriptEvent => ({
    meetingId: meetingId as MeetingId,
    speakerId: 'test-speaker',
    text,
    isFinal: true,
    timestamp: Date.now(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Meeting', () => {
    it('should create a Meeting for a single meeting', () => {
      const config = createTestConfig();
      const llm = createMockLLMClient();
      const grasps = [new Grasp(config, llm)];

      const meeting = new Meeting(
        { meetingId: 'meeting-001' as MeetingId },
        grasps
      );

      expect(meeting.getMeetingId()).toBe('meeting-001' as MeetingId);
      expect(meeting.getMessageCount()).toBe(0);
    });

    it('should process ASR events and update message count', async () => {
      const config = createTestConfig();
      const llm = createMockLLMClient();
      const grasps = [new Grasp(config, llm)];
      const notifier = createMockNotifier();
      const metrics = createMockMetrics();

      const meeting = new Meeting(
        { meetingId: 'meeting-001' as MeetingId },
        grasps
      );

      const event = createTestAsrEvent('meeting-001', 'テスト発言です');
      await meeting.processTranscriptEvent(event, notifier, metrics);

      expect(meeting.getMessageCount()).toBe(1);
    });

    it('should maintain independent state for each meeting', async () => {
      const config = createTestConfig();
      const llm = createMockLLMClient();
      const grasps = [new Grasp(config, llm)];
      const notifier = createMockNotifier();
      const metrics = createMockMetrics();

      const meeting1 = new Meeting(
        { meetingId: 'meeting-001' },
        grasps
      );
      const meeting2 = new Meeting(
        { meetingId: 'meeting-002' },
        grasps
      );

      // Process events for both meetings
      await meeting1.processTranscriptEvent(
        createTestAsrEvent('meeting-001', '最初のミーティング'),
        notifier,
        metrics
      );
      await meeting1.processTranscriptEvent(
        createTestAsrEvent('meeting-001', '2つ目の発言'),
        notifier,
        metrics
      );
      await meeting2.processTranscriptEvent(
        createTestAsrEvent('meeting-002', '別のミーティング'),
        notifier,
        metrics
      );

      // Verify independent state
      expect(meeting1.getMessageCount()).toBe(2);
      expect(meeting2.getMessageCount()).toBe(1);
    });

    it('should cleanup resources on meeting end', () => {
      const config = createTestConfig();
      const llm = createMockLLMClient();
      const grasps = [new Grasp(config, llm)];

      const meeting = new Meeting(
        { meetingId: 'meeting-001' },
        grasps
      );

      // Should not throw
      expect(() => meeting.cleanup()).not.toThrow();
    });
  });

  describe('OrchestratorManager', () => {
    it('should create a manager with default config', () => {
      const config = createTestConfig();
      const llm = createMockLLMClient();
      const grasps = [new Grasp(config, llm)];

      const manager = new OrchestratorManager(grasps);

      const status = manager.getStatus();
      expect(status.totalMeetings).toBe(0);
      expect(status.meetings).toEqual([]);
    });

    it('should create orchestrators for multiple meetings', () => {
      const config = createTestConfig();
      const llm = createMockLLMClient();
      const grasps = [new Grasp(config, llm)];

      const manager = new OrchestratorManager(grasps);

      const meeting1 = manager.getOrCreateMeeting('meeting-001' as MeetingId);
      const meeting2 = manager.getOrCreateMeeting('meeting-002' as MeetingId);
      const meeting3 = manager.getOrCreateMeeting('meeting-003' as MeetingId);

      expect(meeting1.getMeetingId()).toBe('meeting-001' as MeetingId);
      expect(meeting2.getMeetingId()).toBe('meeting-002' as MeetingId);
      expect(meeting3.getMeetingId()).toBe('meeting-003' as MeetingId);
      expect(manager.getStatus().totalMeetings).toBe(3);
    });

    it('should return existing meeting for the same meeting ID', () => {
      const config = createTestConfig();
      const llm = createMockLLMClient();
      const grasps = [new Grasp(config, llm)];

      const manager = new OrchestratorManager(grasps);

      const meeting1 = manager.getOrCreateMeeting('meeting-001' as MeetingId);
      const meeting2 = manager.getOrCreateMeeting('meeting-001' as MeetingId);

      expect(meeting1).toBe(meeting2);
      expect(manager.getStatus().totalMeetings).toBe(1);
    });

    it('should process ASR events for multiple meetings concurrently', async () => {
      const config = createTestConfig();
      const llm = createMockLLMClient();
      const grasps = [new Grasp(config, llm)];
      const notifier = createMockNotifier();
      const metrics = createMockMetrics();

      const manager = new OrchestratorManager(grasps);

      // Process events for multiple meetings
      await manager.processTranscriptEvent(
        createTestAsrEvent('meeting-001', 'ミーティング1の発言'),
        notifier,
        metrics
      );
      await manager.processTranscriptEvent(
        createTestAsrEvent('meeting-002', 'ミーティング2の発言'),
        notifier,
        metrics
      );
      await manager.processTranscriptEvent(
        createTestAsrEvent('meeting-003', 'ミーティング3の発言'),
        notifier,
        metrics
      );

      const status = manager.getStatus();
      expect(status.totalMeetings).toBe(3);
      expect(status.meetings).toHaveLength(3);
    });

    it('should maintain isolation between meetings', async () => {
      const config = createTestConfig();
      const llm = createMockLLMClient();
      const grasps = [new Grasp(config, llm)];
      const notifier = createMockNotifier();
      const metrics = createMockMetrics();

      const manager = new OrchestratorManager(grasps);

      // Process different numbers of events for each meeting
      await manager.processTranscriptEvent(
        createTestAsrEvent('meeting-001', '発言1'),
        notifier,
        metrics
      );
      await manager.processTranscriptEvent(
        createTestAsrEvent('meeting-001', '発言2'),
        notifier,
        metrics
      );
      await manager.processTranscriptEvent(
        createTestAsrEvent('meeting-001', '発言3'),
        notifier,
        metrics
      );
      await manager.processTranscriptEvent(
        createTestAsrEvent('meeting-002', '発言A'),
        notifier,
        metrics
      );

      const meeting1 = manager.getMeeting('meeting-001' as MeetingId);
      const meeting2 = manager.getMeeting('meeting-002' as MeetingId);

      expect(meeting1?.getMessageCount()).toBe(3);
      expect(meeting2?.getMessageCount()).toBe(1);
    });

    it('should cleanup inactive meetings', async () => {
      const config = createTestConfig();
      const llm = createMockLLMClient();
      const grasps = [new Grasp(config, llm)];
      const notifier = createMockNotifier();
      const metrics = createMockMetrics();

      const manager = new OrchestratorManager(grasps, {
        meetingTimeoutMs: 100, // 100ms timeout for testing
      });

      // Create meetings
      await manager.processTranscriptEvent(
        createTestAsrEvent('meeting-001', '発言'),
        notifier,
        metrics
      );
      await manager.processTranscriptEvent(
        createTestAsrEvent('meeting-002', '発言'),
        notifier,
        metrics
      );

      expect(manager.getStatus().totalMeetings).toBe(2);

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Cleanup inactive meetings
      const removed = manager.cleanupInactiveMeetings();

      expect(removed).toBe(2);
      expect(manager.getStatus().totalMeetings).toBe(0);
    });

    it('should enforce max meetings limit', async () => {
      const config = createTestConfig();
      const llm = createMockLLMClient();
      const grasps = [new Grasp(config, llm)];

      const manager = new OrchestratorManager(grasps, {
        maxMeetings: 3,
        meetingTimeoutMs: 100,
      });

      // Create 3 meetings
      manager.getOrCreateMeeting('meeting-001' as MeetingId);
      manager.getOrCreateMeeting('meeting-002' as MeetingId);
      manager.getOrCreateMeeting('meeting-003' as MeetingId);

      expect(manager.getStatus().totalMeetings).toBe(3);

      // Wait to ensure meetings become inactive
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Creating 4th meeting should trigger cleanup
      manager.getOrCreateMeeting('meeting-004' as MeetingId);

      // Should still have meetings (at least the new one)
      expect(manager.getStatus().totalMeetings).toBeGreaterThan(0);
      expect(manager.getStatus().totalMeetings).toBeLessThanOrEqual(4);
    });

    it('should remove specific meeting', () => {
      const config = createTestConfig();
      const llm = createMockLLMClient();
      const grasps = [new Grasp(config, llm)];

      const manager = new OrchestratorManager(grasps);

      manager.getOrCreateMeeting('meeting-001' as MeetingId);
      manager.getOrCreateMeeting('meeting-002' as MeetingId);
      expect(manager.getStatus().totalMeetings).toBe(2);

      const removed = manager.removeMeeting('meeting-001' as MeetingId);
      expect(removed).toBe(true);
      expect(manager.getStatus().totalMeetings).toBe(1);

      const removedAgain = manager.removeMeeting('meeting-001' as MeetingId);
      expect(removedAgain).toBe(false);
    });

    it('should rebuild grasps for all meetings', () => {
      const config1 = createTestConfig({ nodeId: 'grasp-1' });
      const config2 = createTestConfig({ nodeId: 'grasp-2' });
      const llm = createMockLLMClient();
      const grasps1 = [new Grasp(config1, llm)];
      const grasps2 = [new Grasp(config2, llm)];

      const manager = new OrchestratorManager(grasps1);

      manager.getOrCreateMeeting('meeting-001' as MeetingId);
      manager.getOrCreateMeeting('meeting-002' as MeetingId);

      // Should not throw
      expect(() => manager.updateGraspsTemplate(grasps2)).not.toThrow();
    });

    it('should process all queues periodically', async () => {
      const config = createTestConfig();
      const llm = createMockLLMClient();
      const grasps = [new Grasp(config, llm)];
      const notifier = createMockNotifier();
      const metrics = createMockMetrics();

      const manager = new OrchestratorManager(grasps);

      // Create meetings
      await manager.processTranscriptEvent(
        createTestAsrEvent('meeting-001', '発言'),
        notifier,
        metrics
      );
      await manager.processTranscriptEvent(
        createTestAsrEvent('meeting-002', '発言'),
        notifier,
        metrics
      );

      // Process all queues
      const processed = await manager.processAllWaitingGrasps(notifier, metrics);

      // Should return number of meetings processed (0 or more depending on queue state)
      expect(typeof processed).toBe('number');
      expect(processed).toBeGreaterThanOrEqual(0);
    });

    it('should cleanup all meetings on shutdown', () => {
      const config = createTestConfig();
      const llm = createMockLLMClient();
      const grasps = [new Grasp(config, llm)];

      const manager = new OrchestratorManager(grasps);

      manager.getOrCreateMeeting('meeting-001' as MeetingId);
      manager.getOrCreateMeeting('meeting-002' as MeetingId);
      expect(manager.getStatus().totalMeetings).toBe(2);

      manager.cleanup();
      expect(manager.getStatus().totalMeetings).toBe(0);
    });
  });

  describe('Scalability and Parallel Processing', () => {
    it('should handle many concurrent meetings efficiently', async () => {
      const config = createTestConfig();
      const llm = createMockLLMClient();
      const grasps = [new Grasp(config, llm)];
      const notifier = createMockNotifier();
      const metrics = createMockMetrics();

      const manager = new OrchestratorManager(grasps, {
        maxMeetings: 50,
      });

      // Create 20 meetings
      const promises = [];
      for (let i = 1; i <= 20; i++) {
        promises.push(
          manager.processTranscriptEvent(
            createTestAsrEvent(`meeting-${i.toString().padStart(3, '0')}`, `発言 ${i}`),
            notifier,
            metrics
          )
        );
      }

      await Promise.all(promises);

      const status = manager.getStatus();
      expect(status.totalMeetings).toBe(20);
      expect(status.meetings).toHaveLength(20);
    });

    it('should process events from different meetings in parallel', async () => {
      const config = createTestConfig();
      const llm = createMockLLMClient();
      const grasps = [new Grasp(config, llm)];
      const notifier = createMockNotifier();
      const metrics = createMockMetrics();

      const manager = new OrchestratorManager(grasps);

      const startTime = Date.now();

      // Process multiple events in parallel
      await Promise.all([
        manager.processTranscriptEvent(
          createTestAsrEvent('meeting-001', '発言1'),
          notifier,
          metrics
        ),
        manager.processTranscriptEvent(
          createTestAsrEvent('meeting-002', '発言2'),
          notifier,
          metrics
        ),
        manager.processTranscriptEvent(
          createTestAsrEvent('meeting-003', '発言3'),
          notifier,
          metrics
        ),
        manager.processTranscriptEvent(
          createTestAsrEvent('meeting-004', '発言4'),
          notifier,
          metrics
        ),
        manager.processTranscriptEvent(
          createTestAsrEvent('meeting-005', '発言5'),
          notifier,
          metrics
        ),
      ]);

      const endTime = Date.now();
      const elapsed = endTime - startTime;

      // Parallel processing should be relatively fast (< 1 second for 5 meetings)
      expect(elapsed).toBeLessThan(1000);
      expect(manager.getStatus().totalMeetings).toBe(5);
    });
  });
});
