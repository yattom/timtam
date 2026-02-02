import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const GRASP_CONFIGS_TABLE = process.env.GRASP_CONFIGS_TABLE || 'timtam-grasp-configs';

const ddbClient = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(ddbClient);

export type GraspConfigItem = {
  configId: string;
  name: string;
  yaml: string;
  createdAt: number;
  updatedAt: number;
};

/**
 * Sort Grasp configs: DEFAULT first, then by updatedAt desc
 */
export function sortGraspConfigs(configs: GraspConfigItem[]): GraspConfigItem[] {
  return [...configs].sort((a, b) => {
    const aIsDefault = a.name === 'DEFAULT';
    const bIsDefault = b.name === 'DEFAULT';

    if (aIsDefault !== bIsDefault) {
      return aIsDefault ? -1 : 1;
    }
    return b.updatedAt - a.updatedAt;
  });
}

/**
 * GET /grasp/configs
 * Get all Grasp configuration presets
 */
export const handler: APIGatewayProxyHandlerV2 = async () => {
  try {
    const result = await ddb.send(
      new ScanCommand({
        TableName: GRASP_CONFIGS_TABLE,
      })
    );

    const configs = (result.Items || []).map(item => ({
      configId: item.configId,
      name: item.name,
      yaml: item.yaml,
      createdAt: item.createdAt || 0,
      updatedAt: item.updatedAt || 0,
    }));

    const sortedConfigs = sortGraspConfigs(configs);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        configs: sortedConfigs,
      }),
    };
  } catch (err: any) {
    console.error('[GetGraspConfigs] Error', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: false,
        error: err?.message || 'Internal server error'
      }),
    };
  }
};
