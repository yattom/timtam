import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

/**
 * Default Grasp configuration (YAML)
 * This is used as fallback when no configuration exists in DynamoDB
 */
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
 * Ensure default Grasp configuration exists in DynamoDB
 * If no configuration is found, initialize with DEFAULT_GRASP_YAML
 *
 * @param region AWS region
 * @param configTableName DynamoDB table name for orchestrator config
 * @returns The YAML configuration string (either existing or newly created)
 */
export async function ensureDefaultGraspConfig(
  region: string,
  configTableName: string
): Promise<string> {
  const ddbClient = new DynamoDBClient({ region });
  const ddb = DynamoDBDocumentClient.from(ddbClient);

  try {
    // Check if configuration already exists
    const result = await ddb.send(
      new GetCommand({
        TableName: configTableName,
        Key: { configKey: 'current_grasp_config' },
      })
    );

    if (result.Item?.yaml) {
      console.log(JSON.stringify({
        type: 'orchestrator.selfSetup.configExists',
        yamlLength: result.Item.yaml.length,
        ts: Date.now(),
      }));
      return result.Item.yaml;
    }

    // No configuration exists, initialize with default
    const updatedAt = Date.now();
    await ddb.send(
      new PutCommand({
        TableName: configTableName,
        Item: {
          configKey: 'current_grasp_config',
          yaml: DEFAULT_GRASP_YAML,
          updatedAt,
        },
      })
    );

    console.log(JSON.stringify({
      type: 'orchestrator.selfSetup.configInitialized',
      yamlLength: DEFAULT_GRASP_YAML.length,
      updatedAt,
      ts: Date.now(),
    }));

    return DEFAULT_GRASP_YAML;
  } catch (error) {
    console.error(JSON.stringify({
      type: 'orchestrator.selfSetup.error',
      error: (error as Error).message,
      ts: Date.now(),
    }));
    throw error;
  }
}
