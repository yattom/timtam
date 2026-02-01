import * as YAML from 'js-yaml';

/**
 * Minimal validation for Grasp configuration YAML
 * Detailed validation happens in the orchestrator
 */
export function validateGraspConfigYaml(yaml: string): void {
  // Parse YAML
  let parsed: any;
  try {
    parsed = YAML.load(yaml);
  } catch (error: any) {
    throw new Error(`Invalid YAML: ${error.message}`);
  }

  // Check if it's an object
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('YAML must be an object');
  }

  // Check if grasps field exists
  if (!parsed.grasps) {
    throw new Error('Missing required field: grasps');
  }

  // Check if grasps is an array
  if (!Array.isArray(parsed.grasps)) {
    throw new Error('Field "grasps" must be an array');
  }

  // Basic validation for each grasp
  for (let i = 0; i < parsed.grasps.length; i++) {
    const grasp = parsed.grasps[i];
    const prefix = `grasps[${i}]`;

    if (!grasp || typeof grasp !== 'object') {
      throw new Error(`${prefix}: must be an object`);
    }

    // Check required fields
    if (!grasp.nodeId || typeof grasp.nodeId !== 'string') {
      throw new Error(`${prefix}: nodeId is required and must be a string`);
    }

    if (!grasp.promptTemplate || typeof grasp.promptTemplate !== 'string') {
      throw new Error(`${prefix}: promptTemplate is required and must be a string`);
    }

    if (!grasp.outputHandler || typeof grasp.outputHandler !== 'string') {
      throw new Error(`${prefix}: outputHandler is required and must be a string`);
    }

    if (!['chat', 'note', 'both'].includes(grasp.outputHandler)) {
      throw new Error(`${prefix}: outputHandler must be "chat", "note", or "both"`);
    }

    if (grasp.intervalSec === undefined || grasp.intervalSec === null) {
      throw new Error(`${prefix}: intervalSec is required`);
    }

    if (typeof grasp.intervalSec !== 'number' || grasp.intervalSec <= 0) {
      throw new Error(`${prefix}: intervalSec must be a positive number`);
    }

    // Check noteTag for note/both output handlers
    if ((grasp.outputHandler === 'note' || grasp.outputHandler === 'both') && !grasp.noteTag) {
      throw new Error(`${prefix}: noteTag is required when outputHandler is "note" or "both"`);
    }
  }
}
