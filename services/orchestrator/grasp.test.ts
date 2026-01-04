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
    const windowBuffer = new WindowBuffer();
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

  it('should build correct prompt', async () => {
    // arrange
    // Setup: Create a simple Grasp configuration
    const config: GraspConfig = {
      nodeId: 'test-grasp',
      promptTemplate: '以下の会議内容を確認してください:\n',
      inputLength: 3, // 最新3行のみ
      cooldownMs: 1000,
      outputHandler: 'chat',
    };

    // Setup: Create WindowBuffer with test data
    const windowBuffer = new WindowBuffer();
    windowBuffer.push('対象外の発言です', 1000);
    windowBuffer.push('最初の発言です', 2000);
    windowBuffer.push('次の発言です', 3000);
    windowBuffer.push('最後の発言です', 4000);

    // Setup: Create Notebook
    const notebook = new Notebook('test-meeting-001');
    const grasp = new Grasp(config, null);

    // act - buildPrompt()
    const prompt = grasp.buildPrompt(windowBuffer, notebook);

    // Assert: Verify the prompt was generated correctly
    expect(prompt).toContain('以下の会議内容を確認してください:');
    expect(prompt).toContain('最初の発言です');
    expect(prompt).toContain('次の発言です');
    expect(prompt).toContain('最後の発言です');
    expect(prompt).not.toContain('対象外の発言です');
  });

  it('should pass prompt to LLM', async () => {
    // Setup: Create a simple Grasp configuration
    const config: GraspConfig = {
      nodeId: 'test-grasp',
      promptTemplate: '以下の会議内容を確認してください:\n',
      inputLength: 3, // 最新3行のみ
      cooldownMs: 1000,
      outputHandler: 'chat',
    };

    // Setup: Create mock dependencies
    const mockLLMClient: LLMClient = {
      invoke: vi.fn(async (prompt: string, nodeId: string): Promise<JudgeResult> => {
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

    // Execute: Create Grasp instance and execute
    const grasp = new Grasp(config, mockLLMClient);
    const result = await grasp.invokeLLM('prompt', 'test-meeting-001', mockNotifier);

    // Assert: Verify LLM was called with correct nodeId
    expect(mockLLMClient.invoke).toHaveBeenCalledWith(
      'prompt',
      'test-grasp'
    );
  });
  it('should output the response from LLM', async () => {
    // Setup: Create a simple Grasp configuration
    const config: GraspConfig = {
      nodeId: 'test-grasp',
      promptTemplate: '以下の会議内容を確認してください:\n',
      inputLength: 3, // 最新3行のみ
      cooldownMs: 1000,
      outputHandler: 'chat',
    };

    const mockNotifier: Notifier = {
      postChat: vi.fn(),
      postLlmCallLog: vi.fn(),
    };

    // Setup: Create Notebook
    const notebook = new Notebook('test-meeting-001');

    // Execute: Create Grasp instance and execute
    const grasp = new Grasp(config, null);
    await grasp.reflectResponse(
      {
        result: {
          should_intervene: true,
          message: 'response from LLM',
        }
      },
      'test-meeting-001',
      mockNotifier,
      null
    );

    // Assert: Verify LLM call was logged
    expect(mockNotifier.postChat).toHaveBeenCalledWith(
      'test-meeting-001',
      'response from LLM'
    );
  });
  it('should record the response from LLM', async () => {
    // Setup: Create a simple Grasp configuration
    const config: GraspConfig = {
      nodeId: 'test-grasp',
      promptTemplate: '以下の会議内容を確認してください:\n',
      inputLength: 3, // 最新3行のみ
      cooldownMs: 1000,
      outputHandler: 'note',
      noteTag: 'test-note-tag',
    };

    // Setup: Create Notebook
    const notebook = new Notebook('test-meeting-001');

    // Execute: Create Grasp instance and execute
    const grasp = new Grasp(config, null);
    await grasp.reflectResponse(
      {
        result: {
          should_intervene: true,
          message: 'response from LLM',
        }
      },
      'test-meeting-001',
      null,
      notebook
    );

    const writtenNote = notebook.getNotesByTag('test-note-tag')[0];
    expect(writtenNote.content).toEqual('response from LLM');
  });
});
