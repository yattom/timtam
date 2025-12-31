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

  it('parses three grasps', () => {
    const yaml = `
grasps:
  - nodeId: "grasp-1"
    promptTemplate: "first prompt"
    intervalSec: 5
    outputHandler: "chat"
  - nodeId: "grasp-2"
    promptTemplate: "second prompt"
    intervalSec: 10
    outputHandler: "chat"
  - nodeId: "grasp-3"
    promptTemplate: "third prompt"
    intervalSec: 15
    outputHandler: "chat"
`;
    const result = parseGraspGroupDefinition(yaml);

    expect(result.grasps).toHaveLength(3);
    expect(result.grasps[0].nodeId).toBe('grasp-1');
    expect(result.grasps[1].nodeId).toBe('grasp-2');
    expect(result.grasps[2].nodeId).toBe('grasp-3');
    // Spot check one property from different grasps
    expect(result.grasps[1].intervalSec).toBe(10);
    expect(result.grasps[2].promptTemplate).toBe('third prompt');
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
      it('undefined parameter', () => expectInvalid(`
grasps:
  - nodeId: "test-grasp"
    promptTemplate: "test prompt"
    intervalSec: 10
    outputHandler: "chat"
    aiPower: "super"
`));
  })

  describe('template variable format validation', () => {
    const expectInvalid = (yaml: string) =>
      expect(() => parseGraspGroupDefinition(yaml)).toThrow();

    describe('{{INPUT}} format', () => {
      it('valid: {{INPUT}} without modifier', () => {
        const yaml = `
grasps:
  - nodeId: "test"
    promptTemplate: "{{INPUT}}"
    intervalSec: 10
    outputHandler: "chat"
`;
        expect(() => parseGraspGroupDefinition(yaml)).not.toThrow();
      });

      it('valid: {{INPUT:all}}', () => {
        const yaml = `
grasps:
  - nodeId: "test"
    promptTemplate: "{{INPUT:all}}"
    intervalSec: 10
    outputHandler: "chat"
`;
        expect(() => parseGraspGroupDefinition(yaml)).not.toThrow();
      });

      it('valid: {{INPUT:latest5}}', () => {
        const yaml = `
grasps:
  - nodeId: "test"
    promptTemplate: "{{INPUT:latest5}}"
    intervalSec: 10
    outputHandler: "chat"
`;
        expect(() => parseGraspGroupDefinition(yaml)).not.toThrow();
      });

      it('valid: {{INPUT:past30m}}', () => {
        const yaml = `
grasps:
  - nodeId: "test"
    promptTemplate: "{{INPUT:past30m}}"
    intervalSec: 10
    outputHandler: "chat"
`;
        expect(() => parseGraspGroupDefinition(yaml)).not.toThrow();
      });

      it('valid: {{INPUT:past2h}}', () => {
        const yaml = `
grasps:
  - nodeId: "test"
    promptTemplate: "{{INPUT:past2h}}"
    intervalSec: 10
    outputHandler: "chat"
`;
        expect(() => parseGraspGroupDefinition(yaml)).not.toThrow();
      });

      it('invalid: {{INPUT:invalid}}', () => expectInvalid(`
grasps:
  - nodeId: "test"
    promptTemplate: "{{INPUT:invalid}}"
    intervalSec: 10
    outputHandler: "chat"
`));

      it('invalid: {{INPUT:latest}} without number', () => expectInvalid(`
grasps:
  - nodeId: "test"
    promptTemplate: "{{INPUT:latest}}"
    intervalSec: 10
    outputHandler: "chat"
`));

      it('invalid: {{INPUT:past}} without time', () => expectInvalid(`
grasps:
  - nodeId: "test"
    promptTemplate: "{{INPUT:past}}"
    intervalSec: 10
    outputHandler: "chat"
`));
    });

    describe('{{NOTES}} format', () => {
      it('valid: {{NOTES:tag}}', () => {
        const yaml = `
grasps:
  - nodeId: "writer"
    promptTemplate: "write note"
    intervalSec: 10
    outputHandler: "note"
    noteTag: "my-tag"
  - nodeId: "reader"
    promptTemplate: "{{NOTES:my-tag}}"
    intervalSec: 10
    outputHandler: "chat"
`;
        expect(() => parseGraspGroupDefinition(yaml)).not.toThrow();
      });

      it('valid: {{NOTES:tag:all}}', () => {
        const yaml = `
grasps:
  - nodeId: "writer"
    promptTemplate: "write note"
    intervalSec: 10
    outputHandler: "note"
    noteTag: "my-tag"
  - nodeId: "reader"
    promptTemplate: "{{NOTES:my-tag:all}}"
    intervalSec: 10
    outputHandler: "chat"
`;
        expect(() => parseGraspGroupDefinition(yaml)).not.toThrow();
      });

      it('valid: {{NOTES:tag:latest3}}', () => {
        const yaml = `
grasps:
  - nodeId: "writer"
    promptTemplate: "write note"
    intervalSec: 10
    outputHandler: "note"
    noteTag: "my-tag"
  - nodeId: "reader"
    promptTemplate: "{{NOTES:my-tag:latest3}}"
    intervalSec: 10
    outputHandler: "chat"
`;
        expect(() => parseGraspGroupDefinition(yaml)).not.toThrow();
      });

      it('invalid: {{NOTES}} without tag', () => expectInvalid(`
grasps:
  - nodeId: "test"
    promptTemplate: "{{NOTES}}"
    intervalSec: 10
    outputHandler: "chat"
`));

      it('invalid: {{NOTES:}} with empty tag', () => expectInvalid(`
grasps:
  - nodeId: "test"
    promptTemplate: "{{NOTES:}}"
    intervalSec: 10
    outputHandler: "chat"
`));

      it('invalid: {{NOTES:tag:invalid}}', () => expectInvalid(`
grasps:
  - nodeId: "writer"
    promptTemplate: "write note"
    intervalSec: 10
    outputHandler: "note"
    noteTag: "my-tag"
  - nodeId: "reader"
    promptTemplate: "{{NOTES:my-tag:invalid}}"
    intervalSec: 10
    outputHandler: "chat"
`));
    });
  });

  describe('noteTag handling', () => {
    const expectInvalid = (yaml: string) =>
      expect(() => parseGraspGroupDefinition(yaml)).toThrow();

    it('noteTag is required when outputHandler is "note"', () => expectInvalid(`
grasps:
  - nodeId: "test"
    promptTemplate: "write note"
    intervalSec: 10
    outputHandler: "note"
`));

    it('noteTag is required when outputHandler is "both"', () => expectInvalid(`
grasps:
  - nodeId: "test"
    promptTemplate: "write note"
    intervalSec: 10
    outputHandler: "both"
`));

    it('noteTag is valid when outputHandler is "note" and referenced', () => {
      const yaml = `
grasps:
  - nodeId: "writer"
    promptTemplate: "write note"
    intervalSec: 10
    outputHandler: "note"
    noteTag: "my-tag"
  - nodeId: "reader"
    promptTemplate: "{{NOTES:my-tag}}"
    intervalSec: 10
    outputHandler: "chat"
`;
      expect(() => parseGraspGroupDefinition(yaml)).not.toThrow();
    });

    it('noteTag is valid when outputHandler is "both" and referenced', () => {
      const yaml = `
grasps:
  - nodeId: "writer"
    promptTemplate: "write note"
    intervalSec: 10
    outputHandler: "both"
    noteTag: "my-tag"
  - nodeId: "reader"
    promptTemplate: "{{NOTES:my-tag}}"
    intervalSec: 10
    outputHandler: "chat"
`;
      expect(() => parseGraspGroupDefinition(yaml)).not.toThrow();
    });

    it('noteTag is optional when outputHandler is "chat"', () => {
      const yaml = `
grasps:
  - nodeId: "test"
    promptTemplate: "chat only"
    intervalSec: 10
    outputHandler: "chat"
`;
      expect(() => parseGraspGroupDefinition(yaml)).not.toThrow();
    });
  });

  describe('noteTag reference validation', () => {
    const expectInvalid = (yaml: string) =>
      expect(() => parseGraspGroupDefinition(yaml)).toThrow();

    it('valid: referenced noteTag exists in group', () => {
      const yaml = `
grasps:
  - nodeId: "writer"
    promptTemplate: "write note"
    intervalSec: 10
    outputHandler: "note"
    noteTag: "my-tag"
  - nodeId: "reader"
    promptTemplate: "{{NOTES:my-tag}}"
    intervalSec: 10
    outputHandler: "chat"
`;
      expect(() => parseGraspGroupDefinition(yaml)).not.toThrow();
    });

    it('invalid: referenced noteTag does not exist', () => expectInvalid(`
grasps:
  - nodeId: "reader"
    promptTemplate: "{{NOTES:nonexistent-tag}}"
    intervalSec: 10
    outputHandler: "chat"
`));

    it('invalid: one of multiple referenced tags does not exist', () => expectInvalid(`
grasps:
  - nodeId: "writer1"
    promptTemplate: "write note 1"
    intervalSec: 10
    outputHandler: "note"
    noteTag: "tag1"
  - nodeId: "reader"
    promptTemplate: "{{NOTES:tag1}} and {{NOTES:nonexistent}}"
    intervalSec: 10
    outputHandler: "chat"
`));

    it('valid: multiple grasps with different tags, all referenced correctly', () => {
      const yaml = `
grasps:
  - nodeId: "writer1"
    promptTemplate: "write note 1"
    intervalSec: 10
    outputHandler: "note"
    noteTag: "tag1"
  - nodeId: "writer2"
    promptTemplate: "write note 2"
    intervalSec: 10
    outputHandler: "both"
    noteTag: "tag2"
  - nodeId: "reader"
    promptTemplate: "{{NOTES:tag1}} and {{NOTES:tag2}}"
    intervalSec: 10
    outputHandler: "chat"
`;
      expect(() => parseGraspGroupDefinition(yaml)).not.toThrow();
    });
  });

  describe('unreferenced note writer detection', () => {
    const expectInvalid = (yaml: string) =>
      expect(() => parseGraspGroupDefinition(yaml)).toThrow();

    it('invalid: Grasp writes note but no other Grasp references it', () => expectInvalid(`
grasps:
  - nodeId: "writer"
    promptTemplate: "write note"
    intervalSec: 10
    outputHandler: "note"
    noteTag: "unused-tag"
  - nodeId: "reader"
    promptTemplate: "do something else"
    intervalSec: 10
    outputHandler: "chat"
`));

    it('invalid: multiple note writers, one is not referenced', () => expectInvalid(`
grasps:
  - nodeId: "writer1"
    promptTemplate: "write note 1"
    intervalSec: 10
    outputHandler: "note"
    noteTag: "used-tag"
  - nodeId: "writer2"
    promptTemplate: "write note 2"
    intervalSec: 10
    outputHandler: "note"
    noteTag: "unused-tag"
  - nodeId: "reader"
    promptTemplate: "{{NOTES:used-tag}}"
    intervalSec: 10
    outputHandler: "chat"
`));

    it('valid: note writer is referenced by another Grasp', () => {
      const yaml = `
grasps:
  - nodeId: "writer"
    promptTemplate: "write note"
    intervalSec: 10
    outputHandler: "note"
    noteTag: "my-tag"
  - nodeId: "reader"
    promptTemplate: "{{NOTES:my-tag}}"
    intervalSec: 10
    outputHandler: "chat"
`;
      expect(() => parseGraspGroupDefinition(yaml)).not.toThrow();
    });

    it('valid: note writer with "both" is referenced', () => {
      const yaml = `
grasps:
  - nodeId: "writer"
    promptTemplate: "write note"
    intervalSec: 10
    outputHandler: "both"
    noteTag: "my-tag"
  - nodeId: "reader"
    promptTemplate: "{{NOTES:my-tag}}"
    intervalSec: 10
    outputHandler: "chat"
`;
      expect(() => parseGraspGroupDefinition(yaml)).not.toThrow();
    });
  });

});
