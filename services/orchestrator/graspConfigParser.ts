import * as YAML from 'js-yaml';

export interface Grasp {
  nodeId: string;
  promptTemplate: string;
  cooldownMs: number;
  outputHandler: string;
  noteTag?: string;
}

export interface GraspConfig {
  grasps: Grasp[];
}

export function parseGraspConfig(yaml: string): GraspConfig {
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
  }
  return {
    grasps: parsed.grasps,
  };
}
