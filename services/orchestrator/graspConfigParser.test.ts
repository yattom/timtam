import { describe, it, expect } from 'vitest';
import { parseGraspConfig } from './graspConfigParser';

describe('parseGraspConfig', () => {
  it('parses empty grasps list', () => {
    const yaml = `
grasps: []
`;
    const result = parseGraspConfig(yaml);

    expect(result.grasps).toEqual([]);
  });

  it('parses single minimal grasp', () => {
    const yaml = `
grasps:
  - nodeId: "test-grasp"
    promptTemplate: "test prompt"
    cooldownMs: 1000
    outputHandler: "chat"
`;
    const result = parseGraspConfig(yaml);

    expect(result.grasps).toHaveLength(1);
    expect(result.grasps[0].nodeId).toBe('test-grasp');
    expect(result.grasps[0].promptTemplate).toBe('test prompt');
    expect(result.grasps[0].cooldownMs).toBe(1000);
    expect(result.grasps[0].outputHandler).toBe('chat');
  });
});
