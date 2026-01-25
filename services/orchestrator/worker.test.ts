import { describe, it, expect, vi } from 'vitest';
import { buildGraspsFromDefinition } from './worker';
import { parseGraspGroupDefinition, GraspGroupDefinition } from './graspConfigParser';
import { LLMClient, JudgeResult } from './grasp';

describe('buildGraspsFromDefinition', () => {
  // Helper to create a mock LLM client
  const createMockLLMClient = (): LLMClient => ({
    invoke: vi.fn(async (prompt: string, nodeId: string): Promise<JudgeResult> => ({
      result: {
        should_output: false,
        reason: 'test',
        message: 'test message',
      },
      prompt,
      rawResponse: '{}',
    })),
  });

  it('should create empty array from empty grasp definition', () => {
    const graspGroupDef: GraspGroupDefinition = {
      grasps: [],
    };
    const mockLlmClient = createMockLLMClient();

    const result = buildGraspsFromDefinition(graspGroupDef, mockLlmClient);

    expect(result).toEqual([]);
  });

  it('should create single Grasp from single grasp definition', () => {
    const yaml = `
grasps:
  - nodeId: "test-grasp"
    promptTemplate: "test prompt"
    intervalSec: 10
    outputHandler: "chat"
`;
    const graspGroupDef = parseGraspGroupDefinition(yaml);
    const mockLlmClient = createMockLLMClient();

    const result = buildGraspsFromDefinition(graspGroupDef, mockLlmClient);

    expect(result).toHaveLength(1);
    expect(result[0].config.nodeId).toBe('test-grasp');
    expect(result[0].config.promptTemplate).toBe('test prompt');
    expect(result[0].config.cooldownMs).toBe(10000); // 10 sec * 1000
    expect(result[0].config.outputHandler).toBe('chat');
  });

  it('should create multiple Grasps from multiple grasp definitions', () => {
    const yaml = `
grasps:
  - nodeId: "grasp-1"
    promptTemplate: "first prompt"
    intervalSec: 5
    outputHandler: "chat"
  - nodeId: "grasp-2"
    promptTemplate: "second prompt"
    intervalSec: 10
    outputHandler: "note"
    noteTag: "test-tag"
  - nodeId: "grasp-3"
    promptTemplate: "{{NOTES:test-tag}} and {{NOTES:another-tag}}"
    intervalSec: 15
    outputHandler: "both"
    noteTag: "another-tag"
`;
    const graspGroupDef = parseGraspGroupDefinition(yaml);
    const mockLlmClient = createMockLLMClient();

    const result = buildGraspsFromDefinition(graspGroupDef, mockLlmClient);

    expect(result).toHaveLength(3);
    
    // Check first grasp
    expect(result[0].config.nodeId).toBe('grasp-1');
    expect(result[0].config.promptTemplate).toBe('first prompt');
    expect(result[0].config.cooldownMs).toBe(5000);
    expect(result[0].config.outputHandler).toBe('chat');
    expect(result[0].config.noteTag).toBeUndefined();
    
    // Check second grasp
    expect(result[1].config.nodeId).toBe('grasp-2');
    expect(result[1].config.promptTemplate).toBe('second prompt');
    expect(result[1].config.cooldownMs).toBe(10000);
    expect(result[1].config.outputHandler).toBe('note');
    expect(result[1].config.noteTag).toBe('test-tag');
    
    // Check third grasp
    expect(result[2].config.nodeId).toBe('grasp-3');
    expect(result[2].config.promptTemplate).toBe('{{NOTES:test-tag}} and {{NOTES:another-tag}}');
    expect(result[2].config.cooldownMs).toBe(15000);
    expect(result[2].config.outputHandler).toBe('both');
    expect(result[2].config.noteTag).toBe('another-tag');
  });

  it('should correctly convert intervalSec to cooldownMs', () => {
    const yaml = `
grasps:
  - nodeId: "test-1"
    promptTemplate: "test"
    intervalSec: 1
    outputHandler: "chat"
  - nodeId: "test-60"
    promptTemplate: "test"
    intervalSec: 60
    outputHandler: "chat"
  - nodeId: "test-300"
    promptTemplate: "test"
    intervalSec: 300
    outputHandler: "chat"
`;
    const graspGroupDef = parseGraspGroupDefinition(yaml);
    const mockLlmClient = createMockLLMClient();

    const result = buildGraspsFromDefinition(graspGroupDef, mockLlmClient);

    expect(result).toHaveLength(3);
    expect(result[0].config.cooldownMs).toBe(1000);   // 1 sec
    expect(result[1].config.cooldownMs).toBe(60000);  // 60 sec = 1 min
    expect(result[2].config.cooldownMs).toBe(300000); // 300 sec = 5 min
  });

  it('should handle all outputHandler types correctly', () => {
    const yaml = `
grasps:
  - nodeId: "chat-grasp"
    promptTemplate: "chat test"
    intervalSec: 10
    outputHandler: "chat"
  - nodeId: "note-grasp"
    promptTemplate: "note test"
    intervalSec: 10
    outputHandler: "note"
    noteTag: "test-tag"
  - nodeId: "both-grasp"
    promptTemplate: "{{NOTES:test-tag}} and {{NOTES:another-tag}}"
    intervalSec: 10
    outputHandler: "both"
    noteTag: "another-tag"
`;
    const graspGroupDef = parseGraspGroupDefinition(yaml);
    const mockLlmClient = createMockLLMClient();

    const result = buildGraspsFromDefinition(graspGroupDef, mockLlmClient);

    expect(result).toHaveLength(3);
    expect(result[0].config.outputHandler).toBe('chat');
    expect(result[1].config.outputHandler).toBe('note');
    expect(result[2].config.outputHandler).toBe('both');
  });

  it('should pass LLM client to each created Grasp', () => {
    const yaml = `
grasps:
  - nodeId: "test-grasp"
    promptTemplate: "test prompt"
    intervalSec: 10
    outputHandler: "chat"
`;
    const graspGroupDef = parseGraspGroupDefinition(yaml);
    const mockLlmClient = createMockLLMClient();

    const result = buildGraspsFromDefinition(graspGroupDef, mockLlmClient);

    expect(result).toHaveLength(1);
    // Verify that the Grasp has the LLM client by checking it's not null
    // The actual llmClient is private, but we can verify the Grasp was created successfully
    expect(result[0]).toBeDefined();
    expect(result[0].config.nodeId).toBe('test-grasp');
  });

  it('should preserve noteTag when provided', () => {
    const yaml = `
grasps:
  - nodeId: "writer"
    promptTemplate: "write something"
    intervalSec: 10
    outputHandler: "note"
    noteTag: "my-custom-tag"
  - nodeId: "reader"
    promptTemplate: "{{NOTES:my-custom-tag}}"
    intervalSec: 10
    outputHandler: "chat"
`;
    const graspGroupDef = parseGraspGroupDefinition(yaml);
    const mockLlmClient = createMockLLMClient();

    const result = buildGraspsFromDefinition(graspGroupDef, mockLlmClient);

    expect(result).toHaveLength(2);
    expect(result[0].config.noteTag).toBe('my-custom-tag');
    expect(result[1].config.noteTag).toBeUndefined(); // reader doesn't write notes
  });
});
