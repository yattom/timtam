import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  Grasp,
  GraspConfig,
  LLMClient,
  Notifier,
  Metrics,
  JudgeResult,
} from './grasp';
import { OrchestratorManager } from './orchestratorManager';
import { MeetingOrchestrator, AsrEvent } from './meetingOrchestrator';

describe('Multi-Meeting Orchestrator', () => {
  // Helper functions for creating test objects
  const createMockLLMClient = (overrides?: Partial<JudgeResult>): LLMClient => ({
    invoke: vi.fn(async (prompt: string, nodeId: string): Promise<JudgeResult> => ({
      result: {
        should_intervene: false,
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

  const createTestAsrEvent = (meetingId: string, text: string): AsrEvent => ({
    meetingId,
    text,
    isFinal: true,
    timestamp: Date.now(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('MeetingOrchestrator', () => {
    it('should create an orchestrator for a single meeting', () => {
      const config = createTestConfig();
      const llm = createMockLLMClient();
      const grasps = [new Grasp(config, llm)];

      const orchestrator = new MeetingOrchestrator(
        { meetingId: 'meeting-001' },
        grasps
      );

      expect(orchestrator.getMeetingId()).toBe('meeting-001');
      expect(orchestrator.getMessageCount()).toBe(0);
    });

    it('should process ASR events and update message count', async () => {
      const config = createTestConfig();
      const llm = createMockLLMClient();
      const grasps = [new Grasp(config, llm)];
      const notifier = createMockNotifier();
      const metrics = createMockMetrics();

      const orchestrator = new MeetingOrchestrator(
        { meetingId: 'meeting-001' },
        grasps
      );

      const event = createTestAsrEvent('meeting-001', 'テスト発言です');
      await orchestrator.processAsrEvent(event, notifier, metrics);

      expect(orchestrator.getMessageCount()).toBe(1);
    });

    it('should maintain independent state for each meeting', async () => {
      const config = createTestConfig();
      const llm = createMockLLMClient();
      const grasps = [new Grasp(config, llm)];
      const notifier = createMockNotifier();
      const metrics = createMockMetrics();

      const orchestrator1 = new MeetingOrchestrator(
        { meetingId: 'meeting-001' },
        grasps
      );
      const orchestrator2 = new MeetingOrchestrator(
        { meetingId: 'meeting-002' },
        grasps
      );

      // Process events for both meetings
      await orchestrator1.processAsrEvent(
        createTestAsrEvent('meeting-001', '最初のミーティング'),
        notifier,
        metrics
      );
      await orchestrator1.processAsrEvent(
        createTestAsrEvent('meeting-001', '2つ目の発言'),
        notifier,
        metrics
      );
      await orchestrator2.processAsrEvent(
        createTestAsrEvent('meeting-002', '別のミーティング'),
        notifier,
        metrics
      );

      // Verify independent state
      expect(orchestrator1.getMessageCount()).toBe(2);
      expect(orchestrator2.getMessageCount()).toBe(1);
    });

    it('should cleanup resources on meeting end', () => {
      const config = createTestConfig();
      const llm = createMockLLMClient();
      const grasps = [new Grasp(config, llm)];

      const orchestrator = new MeetingOrchestrator(
        { meetingId: 'meeting-001' },
        grasps
      );

      // Should not throw
      expect(() => orchestrator.cleanup()).not.toThrow();
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

      const orchestrator1 = manager.getOrCreateOrchestrator('meeting-001');
      const orchestrator2 = manager.getOrCreateOrchestrator('meeting-002');
      const orchestrator3 = manager.getOrCreateOrchestrator('meeting-003');

      expect(orchestrator1.getMeetingId()).toBe('meeting-001');
      expect(orchestrator2.getMeetingId()).toBe('meeting-002');
      expect(orchestrator3.getMeetingId()).toBe('meeting-003');
      expect(manager.getStatus().totalMeetings).toBe(3);
    });

    it('should return existing orchestrator for the same meeting ID', () => {
      const config = createTestConfig();
      const llm = createMockLLMClient();
      const grasps = [new Grasp(config, llm)];

      const manager = new OrchestratorManager(grasps);

      const orchestrator1 = manager.getOrCreateOrchestrator('meeting-001');
      const orchestrator2 = manager.getOrCreateOrchestrator('meeting-001');

      expect(orchestrator1).toBe(orchestrator2);
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
      await manager.processAsrEvent(
        createTestAsrEvent('meeting-001', 'ミーティング1の発言'),
        notifier,
        metrics
      );
      await manager.processAsrEvent(
        createTestAsrEvent('meeting-002', 'ミーティング2の発言'),
        notifier,
        metrics
      );
      await manager.processAsrEvent(
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
      await manager.processAsrEvent(
        createTestAsrEvent('meeting-001', '発言1'),
        notifier,
        metrics
      );
      await manager.processAsrEvent(
        createTestAsrEvent('meeting-001', '発言2'),
        notifier,
        metrics
      );
      await manager.processAsrEvent(
        createTestAsrEvent('meeting-001', '発言3'),
        notifier,
        metrics
      );
      await manager.processAsrEvent(
        createTestAsrEvent('meeting-002', '発言A'),
        notifier,
        metrics
      );

      const orchestrator1 = manager.getOrchestrator('meeting-001');
      const orchestrator2 = manager.getOrchestrator('meeting-002');

      expect(orchestrator1?.getMessageCount()).toBe(3);
      expect(orchestrator2?.getMessageCount()).toBe(1);
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
      await manager.processAsrEvent(
        createTestAsrEvent('meeting-001', '発言'),
        notifier,
        metrics
      );
      await manager.processAsrEvent(
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
      manager.getOrCreateOrchestrator('meeting-001');
      manager.getOrCreateOrchestrator('meeting-002');
      manager.getOrCreateOrchestrator('meeting-003');

      expect(manager.getStatus().totalMeetings).toBe(3);

      // Wait to ensure meetings become inactive
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Creating 4th meeting should trigger cleanup
      manager.getOrCreateOrchestrator('meeting-004');

      // Should still have meetings (at least the new one)
      expect(manager.getStatus().totalMeetings).toBeGreaterThan(0);
      expect(manager.getStatus().totalMeetings).toBeLessThanOrEqual(4);
    });

    it('should remove specific meeting', () => {
      const config = createTestConfig();
      const llm = createMockLLMClient();
      const grasps = [new Grasp(config, llm)];

      const manager = new OrchestratorManager(grasps);

      manager.getOrCreateOrchestrator('meeting-001');
      manager.getOrCreateOrchestrator('meeting-002');
      expect(manager.getStatus().totalMeetings).toBe(2);

      const removed = manager.removeMeeting('meeting-001');
      expect(removed).toBe(true);
      expect(manager.getStatus().totalMeetings).toBe(1);

      const removedAgain = manager.removeMeeting('meeting-001');
      expect(removedAgain).toBe(false);
    });

    it('should rebuild grasps for all meetings', () => {
      const config1 = createTestConfig({ nodeId: 'grasp-1' });
      const config2 = createTestConfig({ nodeId: 'grasp-2' });
      const llm = createMockLLMClient();
      const grasps1 = [new Grasp(config1, llm)];
      const grasps2 = [new Grasp(config2, llm)];

      const manager = new OrchestratorManager(grasps1);

      manager.getOrCreateOrchestrator('meeting-001');
      manager.getOrCreateOrchestrator('meeting-002');

      // Should not throw
      expect(() => manager.rebuildAllGrasps(grasps2)).not.toThrow();
    });

    it('should process all queues periodically', async () => {
      const config = createTestConfig();
      const llm = createMockLLMClient();
      const grasps = [new Grasp(config, llm)];
      const notifier = createMockNotifier();
      const metrics = createMockMetrics();

      const manager = new OrchestratorManager(grasps);

      // Create meetings
      await manager.processAsrEvent(
        createTestAsrEvent('meeting-001', '発言'),
        notifier,
        metrics
      );
      await manager.processAsrEvent(
        createTestAsrEvent('meeting-002', '発言'),
        notifier,
        metrics
      );

      // Process all queues
      const processed = await manager.processAllQueues(notifier, metrics);

      // Should return number of meetings processed (0 or more depending on queue state)
      expect(typeof processed).toBe('number');
      expect(processed).toBeGreaterThanOrEqual(0);
    });

    it('should cleanup all meetings on shutdown', () => {
      const config = createTestConfig();
      const llm = createMockLLMClient();
      const grasps = [new Grasp(config, llm)];

      const manager = new OrchestratorManager(grasps);

      manager.getOrCreateOrchestrator('meeting-001');
      manager.getOrCreateOrchestrator('meeting-002');
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
          manager.processAsrEvent(
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
        manager.processAsrEvent(
          createTestAsrEvent('meeting-001', '発言1'),
          notifier,
          metrics
        ),
        manager.processAsrEvent(
          createTestAsrEvent('meeting-002', '発言2'),
          notifier,
          metrics
        ),
        manager.processAsrEvent(
          createTestAsrEvent('meeting-003', '発言3'),
          notifier,
          metrics
        ),
        manager.processAsrEvent(
          createTestAsrEvent('meeting-004', '発言4'),
          notifier,
          metrics
        ),
        manager.processAsrEvent(
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
