import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const GRASP_CONFIGS_TABLE = process.env.GRASP_CONFIGS_TABLE || 'timtam-grasp-configs';

const ddbClient = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(ddbClient);

/**
 * GET /grasp/configs/{configId}
 * Get a specific Grasp configuration by ID
 */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const configId = event.pathParameters?.configId;

    if (!configId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'configId is required' }),
      };
    }

    const result = await ddb.send(
      new GetCommand({
        TableName: GRASP_CONFIGS_TABLE,
        Key: { configId },
      })
    );

    if (!result.Item) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'Configuration not found' }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        config: {
          configId: result.Item.configId,
          name: result.Item.name,
          yaml: result.Item.yaml,
          createdAt: result.Item.createdAt,
        },
      }),
    };
  } catch (err: any) {
    console.error('[GetGraspConfig] Error', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err?.message || 'Internal server error' }),
    };
  }
};
