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
  return {
    grasps: parsed.grasps || [],
  };
}
