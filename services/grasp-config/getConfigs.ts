import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const GRASP_CONFIGS_TABLE = process.env.GRASP_CONFIGS_TABLE || 'timtam-grasp-configs';

const ddbClient = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(ddbClient);

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
      isDefault: item.isDefault || false,
      createdAt: item.createdAt || 0,
      updatedAt: item.updatedAt || 0,
    }));

    // Sort by isDefault (default first) then by updatedAt (newest first)
    configs.sort((a, b) => {
      if (a.isDefault !== b.isDefault) {
        return a.isDefault ? -1 : 1;
      }
      return b.updatedAt - a.updatedAt;
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        configs,
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
