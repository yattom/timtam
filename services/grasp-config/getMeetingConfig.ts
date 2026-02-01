import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const GRASP_CONFIGS_TABLE = process.env.GRASP_CONFIGS_TABLE || 'timtam-grasp-configs';
const MEETINGS_METADATA_TABLE = process.env.MEETINGS_METADATA_TABLE || 'timtam-meetings-metadata';

const ddbClient = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(ddbClient);

/**
 * GET /meetings/{meetingId}/grasp-config
 * Get the current Grasp configuration applied to a specific meeting
 */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const meetingId = event.pathParameters?.meetingId;
    if (!meetingId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'meetingId is required' }),
      };
    }

    // Get meeting metadata
    const meetingResult = await ddb.send(
      new GetCommand({
        TableName: MEETINGS_METADATA_TABLE,
        Key: { meetingId },
      })
    );

    if (!meetingResult.Item) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'Meeting not found' }),
      };
    }

    const graspConfigId = meetingResult.Item.graspConfigId;

    // If no graspConfigId, return null config
    if (!graspConfigId) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ok: true,
          configId: null,
          name: null,
          yaml: null,
        }),
      };
    }

    // Get grasp config
    const configResult = await ddb.send(
      new GetCommand({
        TableName: GRASP_CONFIGS_TABLE,
        Key: { configId: graspConfigId },
      })
    );

    if (!configResult.Item) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'Configuration not found' }),
      };
    }

    const { configId, name, yaml, createdAt, updatedAt } = configResult.Item;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        configId,
        name,
        yaml,
        createdAt,
        updatedAt,
      }),
    };
  } catch (err: any) {
    console.error('[GetMeetingConfig] Error', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err?.message || 'Internal server error' }),
    };
  }
};
