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
  Note,
  parseDuration,
  parseLatestCount,
  formatNotes,
  resolveInputVariable,
  resolveNotesVariable,
  replaceTemplateVariables,
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
    promptTemplate: '以下の会議内容を確認してください:\n{{INPUT:latest3}}',
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

  describe('prompteTemplate and buildTemplate', () => {
    it('INPUT and latest lines', async () => {
      // Setup
      const config = createTestConfig({promptTemplate: '入力を読む\n{{INPUT:latest2}}'});
      const windowBuffer = new WindowBuffer();
      windowBuffer.push('対象外の発言です', 1000);
      windowBuffer.push('最初の発言です', 2000);
      windowBuffer.push('最後の発言です', 4000);

      const notebook = new Notebook('test-meeting-001');
      const grasp = new Grasp(config, null);

      // Execute
      const prompt = grasp.buildPrompt(windowBuffer, notebook);

      // Assert
      expect(prompt).toContain('入力を読む');
      expect(prompt).toContain('最初の発言です');
      expect(prompt).toContain('最後の発言です');
      expect(prompt).not.toContain('対象外の発言です');
      expect(prompt).not.toContain('{{INPUT:');
    });
    it('INPUT and past 5 minutes', async () => {
      // Setup
      const now = 10 * 60 * 1000;
      vi.spyOn(Date, 'now').mockReturnValue(now);

      const config = createTestConfig({promptTemplate: '入力を読む\n{{INPUT:past5m}}'});
      const windowBuffer = new WindowBuffer();
      windowBuffer.push('6分前の発言です', now - 6 * 60 * 1000);
      windowBuffer.push('4分前の発言です', now - 4 * 60 * 1000);
      windowBuffer.push('1分前の発言です', now - 1 * 60 * 1000);

      const notebook = new Notebook('test-meeting-001');
      const grasp = new Grasp(config, null);

      // Execute
      const prompt = grasp.buildPrompt(windowBuffer, notebook);

      // Assert
      expect(prompt).toContain('入力を読む');
      expect(prompt).toContain('4分前の発言です');
      expect(prompt).toContain('1分前の発言です');
      expect(prompt).not.toContain('6分前の発言です');
      expect(prompt).not.toContain('{{INPUT:');
    });
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

  describe('helper functions', () => {
    describe('parseDuration', () => {
      it('should parse minutes correctly', () => {
        expect(parseDuration('5m')).toBe(5 * 60 * 1000);
        expect(parseDuration('30m')).toBe(30 * 60 * 1000);
        expect(parseDuration('90m')).toBe(90 * 60 * 1000);
      });

      it('should parse hours correctly', () => {
        expect(parseDuration('1h')).toBe(60 * 60 * 1000);
        expect(parseDuration('2h')).toBe(2 * 60 * 60 * 1000);
      });

      it('should throw error for invalid format', () => {
        expect(() => parseDuration('invalid')).toThrow('Invalid time specification: invalid');
        expect(() => parseDuration('Xm')).toThrow('Invalid time specification: Xm');
        expect(() => parseDuration('5s')).toThrow('Invalid time specification: 5s');
      });
    });

    describe('parseLatestCount', () => {
      it('should parse latest count correctly', () => {
        expect(parseLatestCount('latest1')).toBe(1);
        expect(parseLatestCount('latest5')).toBe(5);
        expect(parseLatestCount('latest10')).toBe(10);
      });

      it('should throw error for invalid format', () => {
        expect(() => parseLatestCount('latest')).toThrow('Invalid latest modifier: latest');
        expect(() => parseLatestCount('latestABC')).toThrow('Invalid latest modifier: latestABC');
        expect(() => parseLatestCount('5')).toThrow('Invalid latest modifier: 5');
      });
    });

    describe('formatNotes', () => {
      it('should format notes with timestamp', () => {
        const notes: Note[] = [
          { tag: 'test', content: '最初のノート', timestamp: 1000, createdBy: 'test-grasp' },
          { tag: 'test', content: '次のノート', timestamp: 2000, createdBy: 'test-grasp' },
        ];
        const formatted = formatNotes(notes);
        expect(formatted).toContain('最初のノート');
        expect(formatted).toContain('次のノート');
        expect(formatted).toContain('\n\n'); // ノート間の区切り
      });

      it('should return empty string for empty notes', () => {
        expect(formatNotes([])).toBe('');
      });
    });
  });

  describe('resolveInputVariable', () => {
    it('should return all content for empty modifier', () => {
      const windowBuffer = new WindowBuffer();
      windowBuffer.push('最初の発言', 1000);
      windowBuffer.push('次の発言', 2000);
      const result = resolveInputVariable('', windowBuffer);
      expect(result).toContain('最初の発言');
      expect(result).toContain('次の発言');
    });

    it('should return all content for "all" modifier', () => {
      const windowBuffer = new WindowBuffer();
      windowBuffer.push('最初の発言', 1000);
      windowBuffer.push('次の発言', 2000);
      const result = resolveInputVariable('all', windowBuffer);
      expect(result).toContain('最初の発言');
      expect(result).toContain('次の発言');
    });

    it('should return latest N lines for "latestN" modifier', () => {
      const windowBuffer = new WindowBuffer();
      windowBuffer.push('対象外', 1000);
      windowBuffer.push('最初の発言', 2000);
      windowBuffer.push('次の発言', 3000);
      const result = resolveInputVariable('latest2', windowBuffer);
      expect(result).toContain('最初の発言');
      expect(result).toContain('次の発言');
      expect(result).not.toContain('対象外');
    });

    it('should return content since duration for "pastNm/h" modifier', () => {
      const now = 10 * 60 * 1000;
      vi.spyOn(Date, 'now').mockReturnValue(now);

      const windowBuffer = new WindowBuffer();
      windowBuffer.push('6分前', now - 6 * 60 * 1000);
      windowBuffer.push('4分前', now - 4 * 60 * 1000);
      windowBuffer.push('1分前', now - 1 * 60 * 1000);

      const result = resolveInputVariable('past5m', windowBuffer);
      expect(result).toContain('4分前');
      expect(result).toContain('1分前');
      expect(result).not.toContain('6分前');

      vi.restoreAllMocks();
    });

    it('should throw error for invalid modifier', () => {
      const windowBuffer = new WindowBuffer();
      expect(() => resolveInputVariable('invalid', windowBuffer)).toThrow('Invalid INPUT modifier: invalid');
    });
  });

  describe('resolveNotesVariable', () => {
    it('should return all notes for tag without modifier', () => {
      const notebook = new Notebook('test-meeting');
      notebook.addNote('mood', '最初のメモ', 'grasp1');
      notebook.addNote('mood', '次のメモ', 'grasp1');

      const result = resolveNotesVariable('mood', notebook);
      expect(result).toContain('最初のメモ');
      expect(result).toContain('次のメモ');
    });

    it('should return all notes for "tag:all" modifier', () => {
      const notebook = new Notebook('test-meeting');
      notebook.addNote('mood', '最初のメモ', 'grasp1');
      notebook.addNote('mood', '次のメモ', 'grasp1');

      const result = resolveNotesVariable('mood:all', notebook);
      expect(result).toContain('最初のメモ');
      expect(result).toContain('次のメモ');
    });

    it('should return latest N notes for "tag:latestN" modifier', () => {
      const notebook = new Notebook('test-meeting');
      notebook.addNote('mood', '古いメモ', 'grasp1');
      notebook.addNote('mood', '最新のメモ1', 'grasp1');
      notebook.addNote('mood', '最新のメモ2', 'grasp1');

      const result = resolveNotesVariable('mood:latest2', notebook);
      expect(result).toContain('最新のメモ1');
      expect(result).toContain('最新のメモ2');
      expect(result).not.toContain('古いメモ');
    });

    it('should return empty string for non-existent tag', () => {
      const notebook = new Notebook('test-meeting');
      const result = resolveNotesVariable('nonexistent', notebook);
      expect(result).toBe('');
    });

    it('should throw error for invalid modifier', () => {
      const notebook = new Notebook('test-meeting');
      expect(() => resolveNotesVariable('mood:invalid', notebook)).toThrow('Invalid NOTES modifier: mood:invalid');
    });
  });

  describe('replaceTemplateVariables', () => {
    it('should replace single INPUT variable', () => {
      const windowBuffer = new WindowBuffer();
      windowBuffer.push('発言1', 1000);
      windowBuffer.push('発言2', 2000);
      const notebook = new Notebook('test-meeting');

      const template = 'プロンプト:\n{{INPUT:latest2}}';
      const result = replaceTemplateVariables(template, windowBuffer, notebook);

      expect(result).toContain('プロンプト:');
      expect(result).toContain('発言1');
      expect(result).toContain('発言2');
      expect(result).not.toContain('{{INPUT:latest2}}');
    });

    it('should replace multiple INPUT variables', () => {
      const windowBuffer = new WindowBuffer();
      windowBuffer.push('発言1', 1000);
      windowBuffer.push('発言2', 2000);
      windowBuffer.push('発言3', 3000);
      const notebook = new Notebook('test-meeting');

      const template = '最新2件:\n{{INPUT:latest2}}\n\n全体:\n{{INPUT:all}}';
      const result = replaceTemplateVariables(template, windowBuffer, notebook);

      expect(result).toContain('最新2件:');
      expect(result).toContain('全体:');
      expect(result).not.toContain('{{INPUT');
    });

    it('should replace NOTES variable', () => {
      const windowBuffer = new WindowBuffer();
      const notebook = new Notebook('test-meeting');
      notebook.addNote('mood', 'メモ1', 'grasp1');
      notebook.addNote('mood', 'メモ2', 'grasp1');

      const template = '雰囲気:\n{{NOTES:mood:latest2}}';
      const result = replaceTemplateVariables(template, windowBuffer, notebook);

      expect(result).toContain('雰囲気:');
      expect(result).toContain('メモ1');
      expect(result).toContain('メモ2');
      expect(result).not.toContain('{{NOTES');
    });

    it('should replace both INPUT and NOTES variables', () => {
      const windowBuffer = new WindowBuffer();
      windowBuffer.push('発言1', 1000);
      const notebook = new Notebook('test-meeting');
      notebook.addNote('mood', 'メモ1', 'grasp1');

      const template = '発言:\n{{INPUT:latest1}}\n\n雰囲気:\n{{NOTES:mood}}';
      const result = replaceTemplateVariables(template, windowBuffer, notebook);

      expect(result).toContain('発言1');
      expect(result).toContain('メモ1');
      expect(result).not.toContain('{{INPUT');
      expect(result).not.toContain('{{NOTES');
    });

    it('should return template as-is when no variables', () => {
      const windowBuffer = new WindowBuffer();
      const notebook = new Notebook('test-meeting');
      const template = 'プロンプトのみ';
      const result = replaceTemplateVariables(template, windowBuffer, notebook);
      expect(result).toBe('プロンプトのみ');
    });
  });
});
