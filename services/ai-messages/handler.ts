import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const AI_MESSAGES_TABLE = process.env.AI_MESSAGES_TABLE || 'timtam-ai-messages';

const ddbClient = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(ddbClient);

/**
 * GET /meetings/{meetingId}/messages
 * Fetch AI intervention messages for a meeting
 * Query params:
 *   - since: timestamp (ms) to fetch messages after (optional)
 *   - limit: max number of messages to return (default: 50)
 */
export const getMessages: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const meetingId = event.pathParameters?.meetingId;
    if (!meetingId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'meetingId is required' }),
      };
    }

    const since = event.queryStringParameters?.since
      ? parseInt(event.queryStringParameters.since, 10)
      : 0;
    const limit = event.queryStringParameters?.limit
      ? parseInt(event.queryStringParameters.limit, 10)
      : 50;

    // Query messages for this meeting, ordered by timestamp
    const result = await ddb.send(
      new QueryCommand({
        TableName: AI_MESSAGES_TABLE,
        KeyConditionExpression: 'meetingId = :meetingId AND #ts > :since',
        ExpressionAttributeNames: {
          '#ts': 'timestamp',
        },
        ExpressionAttributeValues: {
          ':meetingId': meetingId,
          ':since': since,
        },
        Limit: limit,
        ScanIndexForward: true, // Ascending order (oldest first)
      })
    );

    const messages = (result.Items || []).map((item) => ({
      timestamp: item.timestamp,
      message: item.message,
      type: item.type,
    }));

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
      body: JSON.stringify({
        meetingId,
        messages,
        count: messages.length,
      }),
    };
  } catch (err: any) {
    console.error('[GetAiMessages] Error', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err?.message || 'Internal server error' }),
    };
  }
};
