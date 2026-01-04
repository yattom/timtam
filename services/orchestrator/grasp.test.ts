import { describe, it, expect, vi } from 'vitest';
import {
  Grasp,
  GraspConfig,
  WindowBuffer,
  Notebook,
  LLMClient,
  Notifier,
  Metrics,
  JudgeResult,
} from './grasp';

describe('Grasp', () => {
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
    promptTemplate: '以下の会議内容を確認してください:\n',
    inputLength: 3,
    cooldownMs: 1000,
    outputHandler: 'chat',
    ...overrides,
  });

  const createTestJudgeResult = (overrides?: Partial<JudgeResult>): JudgeResult => ({
    result: {
      should_intervene: true,
      reason: 'test',
      message: 'response from LLM',
    },
    prompt: 'test prompt',
    rawResponse: '{}',
    ...overrides,
  });

  it('should build correct prompt', async () => {
    // Setup
    const config = createTestConfig();
    const windowBuffer = new WindowBuffer();
    windowBuffer.push('対象外の発言です', 1000);
    windowBuffer.push('最初の発言です', 2000);
    windowBuffer.push('次の発言です', 3000);
    windowBuffer.push('最後の発言です', 4000);

    const notebook = new Notebook('test-meeting-001');
    const grasp = new Grasp(config, null);

    // Execute
    const prompt = grasp.buildPrompt(windowBuffer, notebook);

    // Assert
    expect(prompt).toContain('以下の会議内容を確認してください:');
    expect(prompt).toContain('最初の発言です');
    expect(prompt).toContain('次の発言です');
    expect(prompt).toContain('最後の発言です');
    expect(prompt).not.toContain('対象外の発言です');
  });

  it('should pass prompt to LLM', async () => {
    // Setup
    const config = createTestConfig();
    const mockLLMClient = createMockLLMClient();
    const mockNotifier = createMockNotifier();

    // Execute
    const grasp = new Grasp(config, mockLLMClient);
    await grasp.invokeLLM('prompt', 'test-meeting-001', mockNotifier);

    // Assert
    expect(mockLLMClient.invoke).toHaveBeenCalledWith(
      'prompt',
      'test-grasp'
    );
    expect(mockNotifier.postLlmCallLog).toHaveBeenCalledWith(
      'test-meeting-001',
      'prompt',
      '{}',
      'test-grasp'
    );
  });

  it('should record execution latency metrics', async () => {
    // Setup
    const config = createTestConfig();
    const mockMetrics = createMockMetrics();
    const startTime = Date.now() - 100; // 100ms ago

    // Execute
    const grasp = new Grasp(config, null);
    await grasp.recordMetrics(mockMetrics, startTime);

    // Assert
    expect(mockMetrics.putLatencyMetric).toHaveBeenCalledWith(
      'Grasp.test-grasp.ExecutionLatency',
      expect.any(Number)
    );
  });

  it('should record E2E latency metrics when ASR timestamp is provided', async () => {
    // Setup
    const config = createTestConfig();
    const mockMetrics = createMockMetrics();
    const startTime = Date.now() - 100;
    const asrTimestamp = Date.now() - 200; // 200ms ago

    // Execute
    const grasp = new Grasp(config, null);
    await grasp.recordMetrics(mockMetrics, startTime, asrTimestamp);

    // Assert
    expect(mockMetrics.putLatencyMetric).toHaveBeenCalledWith(
      'Grasp.test-grasp.ExecutionLatency',
      expect.any(Number)
    );
    expect(mockMetrics.putLatencyMetric).toHaveBeenCalledWith(
      'Grasp.test-grasp.E2ELatency',
      expect.any(Number)
    );
  });

  it('should output the response from LLM to chat', async () => {
    // Setup
    const config = createTestConfig({ outputHandler: 'chat' });
    const mockNotifier = createMockNotifier();
    const notebook = new Notebook('test-meeting-001');
    const judgeResult = createTestJudgeResult();

    // Execute
    const grasp = new Grasp(config, null);
    await grasp.reflectResponse(
      judgeResult,
      'test-meeting-001',
      mockNotifier,
      notebook
    );

    // Assert
    expect(mockNotifier.postChat).toHaveBeenCalledWith(
      'test-meeting-001',
      'response from LLM'
    );
  });

  it('should record the response from LLM to notebook', async () => {
    // Setup
    const config = createTestConfig({
      outputHandler: 'note',
      noteTag: 'test-note-tag',
    });
    const mockNotifier = createMockNotifier();
    const notebook = new Notebook('test-meeting-001');
    const judgeResult = createTestJudgeResult();

    // Execute
    const grasp = new Grasp(config, null);
    await grasp.reflectResponse(
      judgeResult,
      'test-meeting-001',
      mockNotifier,
      notebook
    );

    // Assert
    const writtenNote = notebook.getNotesByTag('test-note-tag')[0];
    expect(writtenNote.content).toEqual('response from LLM');
  });

  it('should output to both chat and notebook when outputHandler is "both"', async () => {
    // Setup
    const config = createTestConfig({
      outputHandler: 'both',
      noteTag: 'test-note-tag',
    });
    const mockNotifier = createMockNotifier();
    const notebook = new Notebook('test-meeting-001');
    const judgeResult = createTestJudgeResult();

    // Execute
    const grasp = new Grasp(config, null);
    await grasp.reflectResponse(
      judgeResult,
      'test-meeting-001',
      mockNotifier,
      notebook
    );

    // Assert
    expect(mockNotifier.postChat).toHaveBeenCalledWith(
      'test-meeting-001',
      'response from LLM'
    );
    const writtenNote = notebook.getNotesByTag('test-note-tag')[0];
    expect(writtenNote.content).toEqual('response from LLM');
  });

  it('should not output when should_intervene is false', async () => {
    // Setup
    const config = createTestConfig({ outputHandler: 'chat' });
    const mockNotifier = createMockNotifier();
    const notebook = new Notebook('test-meeting-001');
    const judgeResult = createTestJudgeResult({
      result: {
        should_intervene: false,
        reason: 'no intervention needed',
        message: 'should not be posted',
      },
    });

    // Execute
    const grasp = new Grasp(config, null);
    await grasp.reflectResponse(
      judgeResult,
      'test-meeting-001',
      mockNotifier,
      notebook
    );

    // Assert
    expect(mockNotifier.postChat).not.toHaveBeenCalled();
  });
});
