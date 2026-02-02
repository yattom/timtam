import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { parseGraspGroupDefinition, GraspGroupDefinition } from './graspConfigParser';
import { Grasp, LLMClient, GraspConfig } from './grasp';

/**
 * Build Grasp instances from a GraspGroupDefinition
 */
export function buildGraspsFromDefinition(graspGroupDef: GraspGroupDefinition, llmClient: LLMClient): Grasp[] {
  const grasps: Grasp[] = [];

  for (const graspDef of graspGroupDef.grasps) {
    const config: GraspConfig = {
      nodeId: graspDef.nodeId,
      promptTemplate: graspDef.promptTemplate,
      cooldownMs: graspDef.intervalSec * 1000,
      outputHandler: graspDef.outputHandler as 'chat' | 'note' | 'both',
      noteTag: graspDef.noteTag,
    };
    const grasp = new Grasp(config, llmClient);
    grasps.push(grasp);
  }

  return grasps;
}

const DEFAULT_GRASP_YAML = `grasps:
  - nodeId: friendly-nodder
    intervalSec: 15
    outputHandler: chat
    promptTemplate: |
      以下は会議の直近発話です。
      {{INPUT:latest5}}

      簡潔で友好的な相槌が必要かを判断してください。

  - nodeId: argument-observer
    intervalSec: 60
    outputHandler: note
    noteTag: argument-notes
    promptTemplate: |
      以下は会議の過去1分間の発話です。
      {{INPUT:past1m}}

      議論や重要なポイントを観察してメモに記録してください。

  - nodeId: summary-provider
    intervalSec: 180
    outputHandler: chat
    promptTemplate: |
      以下はこれまでの議論メモです。
      {{NOTES:argument-notes}}

      議論の短いサマリーを提供するか判断してください。
`;

/**
 * Load Grasp configuration by configId from DynamoDB
 * @param configId Configuration ID (e.g., "DEFAULT-20260125-0123" or custom config ID)
 * @param region AWS region
 * @param graspConfigsTable Table name for grasp configs
 * @returns YAML configuration string
 */
export async function loadGraspConfigById(
  configId: string,
  region: string,
  graspConfigsTable: string
): Promise<string> {
  const ddbClient = new DynamoDBClient({ region });
  const ddb = DynamoDBDocumentClient.from(ddbClient);

  try {
    const result = await ddb.send(
      new GetCommand({
        TableName: graspConfigsTable,
        Key: { configId },
      })
    );

    if (!result.Item?.yaml) {
      throw new Error(`Grasp config not found: ${configId}`);
    }

    console.log(JSON.stringify({
      type: 'orchestrator.graspConfig.loaded',
      configId,
      yamlLength: result.Item.yaml.length,
      ts: Date.now(),
    }));

    return result.Item.yaml;
  } catch (error) {
    console.error(JSON.stringify({
      type: 'orchestrator.graspConfig.loadError',
      configId,
      error: (error as Error).message,
      ts: Date.now(),
    }));
    throw error;
  }
}

/**
 * Get the latest DEFAULT-* Grasp configuration
 * @param region AWS region
 * @param graspConfigsTable Table name for grasp configs
 * @returns YAML configuration string (or hardcoded default if none found)
 */
export async function getDefaultGraspConfig(
  region: string,
  graspConfigsTable: string
): Promise<string> {
  const ddbClient = new DynamoDBClient({ region });
  const ddb = DynamoDBDocumentClient.from(ddbClient);

  try {
    // Scan for configs with name 'DEFAULT'
    const result = await ddb.send(
      new ScanCommand({
        TableName: graspConfigsTable,
        FilterExpression: '#name = :defaultName',
        ExpressionAttributeNames: {
          '#name': 'name',
        },
        ExpressionAttributeValues: {
          ':defaultName': 'DEFAULT',
        },
      })
    );

    if (!result.Items || result.Items.length === 0) {
      console.log(JSON.stringify({
        type: 'orchestrator.graspConfig.noDefaultFound',
        message: 'No DEFAULT config found, using hardcoded default',
        ts: Date.now(),
      }));
      return DEFAULT_GRASP_YAML;
    }

    // Sort by configId (which contains timestamp) to get the latest
    interface ConfigItem {
      configId: string;
      yaml?: string;
    }
    
    const sortedConfigs = (result.Items as ConfigItem[]).sort((a, b) => {
      return b.configId.localeCompare(a.configId);
    });

    const latestConfig = sortedConfigs[0];

    console.log(JSON.stringify({
      type: 'orchestrator.graspConfig.defaultLoaded',
      configId: latestConfig.configId,
      yamlLength: latestConfig.yaml?.length || 0,
      ts: Date.now(),
    }));

    return latestConfig.yaml || DEFAULT_GRASP_YAML;
  } catch (error) {
    console.error(JSON.stringify({
      type: 'orchestrator.graspConfig.defaultLoadError',
      error: (error as Error).message,
      message: 'Falling back to hardcoded default',
      ts: Date.now(),
    }));
    return DEFAULT_GRASP_YAML;
  }
}

/**
 * Load Grasp configuration for a meeting
 * @param meetingId Meeting ID
 * @param region AWS region
 * @param graspConfigsTable Table name for grasp configs
 * @param meetingsMetadataTable Table name for meetings metadata
 * @param llmClient LLM client for building Grasps
 * @returns Array of Grasp instances
 */
export async function loadGraspsForMeeting(
  meetingId: string,
  region: string,
  graspConfigsTable: string,
  meetingsMetadataTable: string,
  llmClient: LLMClient
): Promise<Grasp[]> {
  const ddbClient = new DynamoDBClient({ region });
  const ddb = DynamoDBDocumentClient.from(ddbClient);

  try {
    // Get meeting metadata to check for graspConfigId
    const meetingResult = await ddb.send(
      new GetCommand({
        TableName: meetingsMetadataTable,
        Key: { meetingId },
      })
    );

    let yaml: string;

    if (meetingResult.Item?.graspConfigId) {
      // Load specific config
      yaml = await loadGraspConfigById(
        meetingResult.Item.graspConfigId,
        region,
        graspConfigsTable
      );
      console.log(JSON.stringify({
        type: 'orchestrator.meeting.graspConfig.specific',
        meetingId,
        configId: meetingResult.Item.graspConfigId,
        ts: Date.now(),
      }));
    } else {
      // Load default config
      yaml = await getDefaultGraspConfig(region, graspConfigsTable);
      console.log(JSON.stringify({
        type: 'orchestrator.meeting.graspConfig.default',
        meetingId,
        ts: Date.now(),
      }));
    }

    // Parse YAML and build Grasps
    const graspGroupDef: GraspGroupDefinition = parseGraspGroupDefinition(yaml);
    const grasps = buildGraspsFromDefinition(graspGroupDef, llmClient);

    console.log(JSON.stringify({
      type: 'orchestrator.meeting.grasps.built',
      meetingId,
      graspCount: grasps.length,
      ts: Date.now(),
    }));

    return grasps;
  } catch (error) {
    console.error(JSON.stringify({
      type: 'orchestrator.meeting.grasps.buildError',
      meetingId,
      error: (error as Error).message,
      ts: Date.now(),
    }));
    // Fallback to hardcoded default
    const graspGroupDef = parseGraspGroupDefinition(DEFAULT_GRASP_YAML);
    return buildGraspsFromDefinition(graspGroupDef, llmClient);
  }
}
