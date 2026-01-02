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
  it('should generate correct prompt from configuration and window buffer', async () => {
    // Setup: Create a simple Grasp configuration
    const config: GraspConfig = {
      nodeId: 'test-grasp',
      promptTemplate: '以下の会議内容を確認してください:\n',
      inputLength: 3, // 最新3行のみ
      cooldownMs: 1000,
      outputHandler: 'chat',
    };

    // Setup: Create mock dependencies
    let capturedPrompt = '';
    const mockLLMClient: LLMClient = {
      invoke: vi.fn(async (prompt: string, nodeId: string): Promise<JudgeResult> => {
        capturedPrompt = prompt; // Capture the generated prompt
        return {
          result: {
            should_intervene: false,
            reason: 'test',
            message: 'test message',
          },
          prompt,
          rawResponse: '{}',
        };
      }),
    };

    const mockNotifier: Notifier = {
      postChat: vi.fn(),
      postLlmCallLog: vi.fn(),
    };

    const mockMetrics: Metrics = {
      putLatencyMetric: vi.fn(),
      putCountMetric: vi.fn(),
    };

    // Setup: Create WindowBuffer with test data
    const windowBuffer = new WindowBuffer(5);
    windowBuffer.push('最初の発言です', 1000);
    windowBuffer.push('次の発言です', 2000);
    windowBuffer.push('最後の発言です', 3000);

    // Setup: Create Notebook
    const notebook = new Notebook('test-meeting-001');

    // Execute: Create Grasp instance and execute
    const grasp = new Grasp(config, mockLLMClient);
    await grasp.execute(
      windowBuffer,
      'test-meeting-001',
      mockNotifier,
      mockMetrics,
      notebook
    );

    // Assert: Verify the prompt was generated correctly
    expect(capturedPrompt).toContain('以下の会議内容を確認してください:');
    expect(capturedPrompt).toContain('最初の発言です');
    expect(capturedPrompt).toContain('次の発言です');
    expect(capturedPrompt).toContain('最後の発言です');

    // Assert: Verify LLM was called with correct nodeId
    expect(mockLLMClient.invoke).toHaveBeenCalledWith(
      expect.any(String),
      'test-grasp'
    );

    // Assert: Verify LLM call was logged
    expect(mockNotifier.postLlmCallLog).toHaveBeenCalledWith(
      'test-meeting-001',
      capturedPrompt,
      '{}',
      'test-grasp'
    );

    // Assert: Verify metrics were recorded
    expect(mockMetrics.putLatencyMetric).toHaveBeenCalledWith(
      expect.stringContaining('test-grasp'),
      expect.any(Number)
    );
  });
});
