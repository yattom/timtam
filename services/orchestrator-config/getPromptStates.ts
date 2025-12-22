import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const PROMPT_STATES_TABLE = process.env.PROMPT_STATES_TABLE || 'timtam-prompt-states';

const ddbClient = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(ddbClient);

/**
 * GET /orchestrator/prompt-states/{meetingId}
 * 会議のプロンプト状態を取得
 */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const meetingId = event.pathParameters?.meetingId;

    if (!meetingId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'meetingId is required' }),
      };
    }

    // 最新の状態を取得
    const result = await ddb.send(
      new QueryCommand({
        TableName: PROMPT_STATES_TABLE,
        KeyConditionExpression: 'meetingId = :meetingId',
        ExpressionAttributeValues: {
          ':meetingId': meetingId,
        },
        ScanIndexForward: false, // 降順（最新が先）
        Limit: 1,
      })
    );

    const states = result.Items?.[0]?.states || {};
    const timestamp = result.Items?.[0]?.timestamp || 0;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
      body: JSON.stringify({
        meetingId,
        states,
        timestamp,
      }),
    };
  } catch (err: any) {
    console.error('[GetPromptStates] Error', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err?.message || 'Internal server error' }),
    };
  }
};
