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

    const now = Date.now();

    await ddb.send(
      new UpdateCommand({
        TableName: MEETINGS_METADATA_TABLE,
        Key: { meetingId },
        UpdateExpression:
          'SET #participants = if_not_exists(#participants, :empty), ' +
          '#participants.#attendeeId = :participant, ' +
          '#updatedAt = :now, ' +
          '#startedAt = if_not_exists(#startedAt, :startedAt), ' +
          '#isActive = :active',
        ExpressionAttributeNames: {
          '#participants': 'participants',
          '#attendeeId': attendeeId,
          '#updatedAt': 'updatedAt',
          '#startedAt': 'startedAt',
          '#isActive': 'isActive',
        },
        ExpressionAttributeValues: {
          ':empty': {},
          ':participant': {
            attendeeId,
            externalUserId,
            displayName,
            updatedAt: now,
            joinedAt: now,
          },
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
      return p?.attendeeId && filterIds.includes(p.attendeeId);
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

export const endMeeting: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const meetingId = event.pathParameters?.meetingId;
    if (!meetingId) return json(400, { ok: false, error: 'meetingId is required in path' });

    const now = Date.now();

    const result = await ddb.send(
      new UpdateCommand({
        TableName: MEETINGS_METADATA_TABLE,
        Key: { meetingId },
        UpdateExpression: 'SET #endedAt = :endedAt, #updatedAt = :now, #isActive = :inactive',
        ExpressionAttributeNames: {
          '#endedAt': 'endedAt',
          '#updatedAt': 'updatedAt',
          '#isActive': 'isActive',
        },
        ExpressionAttributeValues: {
          ':endedAt': now,
          ':now': now,
          ':inactive': false,
        },
        ReturnValues: 'ALL_NEW',
      })
    );

    return json(200, {
      ok: true,
      endedAt: result.Attributes?.endedAt ?? now,
      isActive: false,
    });
  } catch (err: any) {
    console.error('[meetingMetadata.endMeeting] error', err?.message || err);
    return json(500, { ok: false, error: err?.message || String(err) });
  }
};
