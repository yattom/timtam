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

function validateInputFormat(modifier: string): boolean {
  if (!modifier || modifier === 'all') return true;
  if (/^latest\d+$/.test(modifier)) return true;
  if (/^past\d+[mh]$/.test(modifier)) return true;
  return false;
}

function validateNotesFormat(parts: string[]): boolean {
  if (parts.length < 2) return false; // {{NOTES}} without tag
  if (!parts[1] || parts[1].trim() === '') return false; // {{NOTES:}} with empty tag
  if (parts.length === 2) return true; // {{NOTES:tag}}
  if (parts.length === 3) {
    const modifier = parts[2];
    if (modifier === 'all') return true;
    if (/^latest\d+$/.test(modifier)) return true;
    return false;
  }
  return false;
}

function validateTemplateVariables(promptTemplate: string): void {
  // Validate {{INPUT:...}} format
  const inputMatches = promptTemplate.matchAll(/\{\{INPUT(?::([^}]+))?\}\}/g);
  for (const match of inputMatches) {
    const modifier = match[1];
    if (!validateInputFormat(modifier)) {
      throw new Error(`Invalid INPUT format: {{INPUT${modifier ? ':' + modifier : ''}}}`);
    }
  }

  // Validate {{NOTES:...}} format - allow empty captures
  const notesMatches = promptTemplate.matchAll(/\{\{NOTES(?::([^}]*))?\}\}/g);
  for (const match of notesMatches) {
    const fullMatch = match[1];
    const parts = ['NOTES', ...(fullMatch !== undefined ? fullMatch.split(':') : [])];
    if (!validateNotesFormat(parts)) {
      throw new Error(`Invalid NOTES format: {{NOTES${fullMatch !== undefined ? ':' + fullMatch : ''}}}`);
    }
  }
}

export function parseGraspGroupDefinition(yaml: string): GraspGroupDefinition {
  const parsed = YAML.load(yaml) as any;
  if(!parsed.grasps) {
    return {
      grasps: [],
    };
  }
  const allowedKeys = new Set(['nodeId', 'promptTemplate', 'intervalSec', 'outputHandler', 'noteTag']);

  for(const grasp of parsed.grasps) {
    // Check for undefined parameters
    const graspKeys = Object.keys(grasp);
    for(const key of graspKeys) {
      if(!allowedKeys.has(key)) {
        throw new Error(`Unknown parameter: ${key}`);
      }
    }

    if(!grasp.nodeId) {
      throw new Error('nodeId is required');
    }
    if(!grasp.promptTemplate) {
      throw new Error('promptTemplate is required');
    }

    // Validate template variable formats
    validateTemplateVariables(grasp.promptTemplate);

    if(!grasp.outputHandler || !['chat', 'note', 'both'].includes(grasp.outputHandler)) {
      throw new Error('outputHandler must be "chat" or "note" or "both"');
    }

    // Validate noteTag is required for note/both output handlers
    if ((grasp.outputHandler === 'note' || grasp.outputHandler === 'both') && !grasp.noteTag) {
      throw new Error('noteTag is required when outputHandler is "note" or "both"');
    }

    if(grasp.intervalSec === undefined || grasp.intervalSec === null) {
      throw new Error('intervalSec is required');
    }
    if(typeof grasp.intervalSec !== 'number' || grasp.intervalSec <= 0) {
      throw new Error('intervalSec must be a positive number');
    }
  }

  // Cross-grasp validation: verify all referenced noteTags exist
  const availableNoteTags = new Set<string>();
  for (const grasp of parsed.grasps) {
    if ((grasp.outputHandler === 'note' || grasp.outputHandler === 'both') && grasp.noteTag) {
      availableNoteTags.add(grasp.noteTag);
    }
  }

  // Collect all referenced noteTags
  const referencedNoteTags = new Set<string>();
  for (const grasp of parsed.grasps) {
    // Extract all {{NOTES:tag:...}} references
    const notesMatches = grasp.promptTemplate.matchAll(/\{\{NOTES:([^}:]+)(?::[^}]*)?\}\}/g);
    for (const match of notesMatches) {
      const referencedTag = match[1];
      referencedNoteTags.add(referencedTag);
      if (!availableNoteTags.has(referencedTag)) {
        throw new Error(`Referenced noteTag "${referencedTag}" does not exist in any Grasp in this group`);
      }
    }
  }

  // Verify all note writers are referenced by at least one other Grasp
  for (const noteTag of availableNoteTags) {
    if (!referencedNoteTags.has(noteTag)) {
      throw new Error(`noteTag "${noteTag}" is written but not referenced by any Grasp in this group`);
    }
  }

  return {
    grasps: parsed.grasps,
  };
}
