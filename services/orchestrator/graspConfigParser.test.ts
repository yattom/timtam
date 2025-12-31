import { describe, it, expect } from 'vitest';
import { parseGraspGroupDefinition } from './graspConfigParser';

describe('parseGraspGroupDefinition', () => {
  it('parses empty grasps list', () => {
    const yaml = `
grasps: []
`;
    const result = parseGraspGroupDefinition(yaml);

    expect(result.grasps).toEqual([]);
  });

  it('parses single minimal grasp', () => {
    const yaml = `
grasps:
  - nodeId: "test-grasp"
    promptTemplate: "test prompt"
    intervalSec: 1
    outputHandler: "chat"
`;
    const result = parseGraspGroupDefinition(yaml);

    expect(result.grasps).toHaveLength(1);
    expect(result.grasps[0].nodeId).toBe('test-grasp');
    expect(result.grasps[0].promptTemplate).toBe('test prompt');
    expect(result.grasps[0].intervalSec).toBe(1);
    expect(result.grasps[0].outputHandler).toBe('chat');
  });

  describe('invalid input must throw error', () => {
    const expectInvalid = (yaml: string) =>
      expect(() => parseGraspGroupDefinition(yaml)).toThrow();

    it('nodeId is missing', () => expectInvalid(`
grasps:
  - promptTemplate: "test prompt"
    intervalSec: 10
    outputHandler: "chat"
`));

    it('promptTemplate is missing', () => expectInvalid(`
grasps:
  - nodeId: "test-grasp"
    intervalSec: 10
    outputHandler: "chat"
`));

    it('promptTemplate is empty', () => expectInvalid(`
grasps:
  - nodeId: "test-grasp"
    promptTemplate: ""
    intervalSec: 10
    outputHandler: "chat"
`));

    it('outputHandler is missing', () => expectInvalid(`
grasps:
  - nodeId: "test-grasp"
    promptTemplate: "test prompt"
    intervalSec: 10
`));

    it('outputHandler is wrong', () => expectInvalid(`
grasps:
  - nodeId: "test-grasp"
    promptTemplate: "test prompt"
    intervalSec: 10
    outputHandler: "WRONG"
`));

    it('intervalSec is missing', () => expectInvalid(`
grasps:
  - nodeId: "test-grasp"
    promptTemplate: "test prompt"
    outputHandler: "chat"
`));

    it('intervalSec is negative', () => expectInvalid(`
grasps:
  - nodeId: "test-grasp"
    promptTemplate: "test prompt"
    intervalSec: -5
    outputHandler: "chat"
`));

    it('intervalSec is zero', () => expectInvalid(`
grasps:
  - nodeId: "test-grasp"
    promptTemplate: "test prompt"
    intervalSec: 0
    outputHandler: "chat"
`));
  })

});
