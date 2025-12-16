import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const CONFIG_TABLE = process.env.CONFIG_TABLE_NAME || 'timtam-orchestrator-config';
const DEFAULT_PROMPT = process.env.DEFAULT_PROMPT ||
  '会話の内容が具体的に寄りすぎていたり、抽象的になりすぎていたら指摘してください';

const ddbClient = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(ddbClient);

/**
 * GET /orchestrator/prompt
 * Get the current orchestrator prompt configuration
 */
export const handler: APIGatewayProxyHandlerV2 = async () => {
  try {
    const result = await ddb.send(
      new GetCommand({
        TableName: CONFIG_TABLE,
        Key: { configKey: 'current_prompt' },
      })
    );

    const prompt = result.Item?.prompt || DEFAULT_PROMPT;
    const updatedAt = result.Item?.updatedAt || 0;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
      body: JSON.stringify({
        prompt,
        updatedAt,
      }),
    };
  } catch (err: any) {
    console.error('[GetPrompt] Error', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err?.message || 'Internal server error' }),
    };
  }
};
