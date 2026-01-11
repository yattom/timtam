import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const CONFIG_TABLE = process.env.CONFIG_TABLE_NAME || 'timtam-orchestrator-config';

const ddbClient = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(ddbClient);

/**
 * GET /grasp/config/current
 * Get the current Grasp configuration
 */
export const handler: APIGatewayProxyHandlerV2 = async () => {
  try {
    const result = await ddb.send(
      new GetCommand({
        TableName: CONFIG_TABLE,
        Key: { configKey: 'current_grasp_config' },
      })
    );

    if (!result.Item) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ok: false,
          error: 'No Grasp configuration found'
        }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        yaml: result.Item.yaml || '',
        updatedAt: result.Item.updatedAt || 0,
      }),
    };
  } catch (err: any) {
    console.error('[GetCurrentGraspConfig] Error', err);
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
