import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const MEETINGS_METADATA_TABLE = process.env.MEETINGS_METADATA_TABLE || 'timtam-meetings-metadata';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

function json(statusCode: number, body: Record<string, any>) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export const upsertParticipant: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const meetingId = event.pathParameters?.meetingId;
    if (!meetingId) return json(400, { ok: false, error: 'meetingId is required in path' });
    if (!event.body) return json(400, { ok: false, error: 'body is required' });

    const body = JSON.parse(event.body);
    const attendeeId: string | undefined = body.attendeeId;
    const externalUserId: string | undefined = body.externalUserId;
    const displayName: string = (body.displayName || '').trim();
    const startedAt: number | undefined = body.startedAt;

    if (!attendeeId) return json(400, { ok: false, error: 'attendeeId is required' });
    if (!displayName) return json(400, { ok: false, error: 'displayName is required' });
    if (displayName.length > 50) return json(400, { ok: false, error: 'displayName must be 50 characters or less' });

    const now = Date.now();

    // Get current participants map
    const getResult = await ddb.send(
      new GetCommand({
        TableName: MEETINGS_METADATA_TABLE,
        Key: { meetingId },
      })
    );

    const currentParticipants = (getResult.Item?.participants as Record<string, any>) || {};

    // Update or add the participant
    currentParticipants[attendeeId] = {
      attendeeId,
      externalUserId,
      displayName,
      updatedAt: now,
      joinedAt: currentParticipants[attendeeId]?.joinedAt || now,
    };

    // Write back the updated participants map
    await ddb.send(
      new UpdateCommand({
        TableName: MEETINGS_METADATA_TABLE,
        Key: { meetingId },
        UpdateExpression:
          'SET #participants = :participants, ' +
          '#updatedAt = :now, ' +
          '#startedAt = if_not_exists(#startedAt, :startedAt), ' +
          '#isActive = :active',
        ExpressionAttributeNames: {
          '#participants': 'participants',
          '#updatedAt': 'updatedAt',
          '#startedAt': 'startedAt',
          '#isActive': 'isActive',
        },
        ExpressionAttributeValues: {
          ':participants': currentParticipants,
          ':now': now,
          ':startedAt': startedAt || now,
          ':active': true,
        },
        ReturnValues: 'ALL_NEW',
      })
    );

    return json(200, { ok: true });
  } catch (err: any) {
    console.error('[meetingMetadata.upsertParticipant] error', err?.message || err);
    return json(500, { ok: false, error: err?.message || String(err) });
  }
};

export const getParticipants: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const meetingId = event.pathParameters?.meetingId;
    if (!meetingId) return json(400, { ok: false, error: 'meetingId is required in path' });

    const res = await ddb.send(
      new GetCommand({
        TableName: MEETINGS_METADATA_TABLE,
        Key: { meetingId },
      })
    );

    const participantsMap = (res.Item?.participants as Record<string, any> | undefined) || {};
    const filterIds = event.queryStringParameters?.attendeeIds
      ? event.queryStringParameters.attendeeIds.split(',').map((s) => s.trim()).filter(Boolean)
      : null;

    const participants = Object.values(participantsMap).filter((p: any) => {
      if (!filterIds) return true;
      return (p?.attendeeId && filterIds.includes(p.attendeeId)) ||
             (p?.externalUserId && filterIds.includes(p.externalUserId));
    });

    return json(200, {
      participants,
      startedAt: res.Item?.startedAt,
      endedAt: res.Item?.endedAt,
      isActive: res.Item?.isActive !== false,
    });
  } catch (err: any) {
    console.error('[meetingMetadata.getParticipants] error', err?.message || err);
    return json(500, { ok: false, error: err?.message || String(err) });
  }
};
