import * as YAML from 'js-yaml';

export interface GraspDefinition {
  nodeId: string;
  promptTemplate: string;
  intervalSec: number;
  outputHandler: string;
  noteTag?: string;
}

export interface GraspGroupDefinition {
  grasps: GraspDefinition[];
}

export function parseGraspGroupDefinition(yaml: string): GraspGroupDefinition {
  const parsed = YAML.load(yaml) as any;
  if(!parsed.grasps) {
    return {
      grasps: [],
    };
  }
  for(const grasp of parsed.grasps) {
    if(!grasp.nodeId) {
      throw new Error('nodeId is required');
    }
    if(!grasp.promptTemplate) {
      throw new Error('promptTemplate is required');
    }
    if(!grasp.outputHandler || !['chat', 'note', 'both'].includes(grasp.outputHandler)) {
      throw new Error('outputHandler must be "chat" or "note" or "both"');
    }
    if(grasp.intervalSec === undefined || grasp.intervalSec === null) {
      throw new Error('intervalSec is required');
    }
    if(typeof grasp.intervalSec !== 'number' || grasp.intervalSec <= 0) {
      throw new Error('intervalSec must be a positive number');
    }
  }
  return {
    grasps: parsed.grasps,
  };
}
