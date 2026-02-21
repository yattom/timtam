import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { listHandler, getHandler, leaveHandler, getUserId, canAccessMeeting } from './recallMeetings';
import { APIGatewayProxyEventV2 } from 'aws-lambda';

const ddbMock = mockClient(DynamoDBDocumentClient);

// =============================================
// getUserId - pure function tests (no mocks)
// =============================================
describe('getUserId', () => {
  it('JWTクレームのsubからユーザーIDを取得すること', () => {
    const event = {
      requestContext: {
        authorizer: {
          jwt: { claims: { sub: 'user-abc-123' } },
        },
      },
    };
    expect(getUserId(event)).toBe('user-abc-123');
  });

  it('authorizerが存在しない場合はundefinedを返すこと', () => {
    expect(getUserId({ requestContext: {} })).toBeUndefined();
  });

  it('jwtが存在しない場合はundefinedを返すこと', () => {
    expect(getUserId({ requestContext: { authorizer: {} } })).toBeUndefined();
  });

  it('requestContextが存在しない場合はundefinedを返すこと', () => {
    expect(getUserId({})).toBeUndefined();
  });
});

// =============================================
// canAccessMeeting - pure function tests (no mocks)
// =============================================
describe('canAccessMeeting', () => {
  it('hostUserIdが一致する場合はtrueを返すこと', () => {
    expect(canAccessMeeting('user-123', 'user-123')).toBe(true);
  });

  it('hostUserIdが異なる場合はfalseを返すこと', () => {
    expect(canAccessMeeting('user-123', 'user-456')).toBe(false);
  });

  it('アイテムにhostUserIdがない場合はtrueを返すこと（旧データ互換）', () => {
    expect(canAccessMeeting('user-123', undefined)).toBe(true);
  });
});

// =============================================
// getHandler テスト (アクセス制御)
// =============================================
describe('recallMeetings - getHandler', () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it('自分のミーティングは200で返すこと', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { meetingId: 'm1', hostUserId: 'user-123', platform: 'recall', status: 'active' },
    });

    const event = {
      pathParameters: { meetingId: 'm1' },
      requestContext: {
        authorizer: { jwt: { claims: { sub: 'user-123' } } },
      },
    } as unknown as APIGatewayProxyEventV2;

    const response = await getHandler(event);
    expect(response.statusCode).toBe(200);
  });

  it('他ユーザーのミーティングは403で拒否すること', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { meetingId: 'm1', hostUserId: 'other-user', platform: 'recall', status: 'active' },
    });

    const event = {
      pathParameters: { meetingId: 'm1' },
      requestContext: {
        authorizer: { jwt: { claims: { sub: 'user-123' } } },
      },
    } as unknown as APIGatewayProxyEventV2;

    const response = await getHandler(event);
    expect(response.statusCode).toBe(403);
  });
});

// =============================================
// leaveHandler テスト (アクセス制御)
// =============================================
describe('recallMeetings - leaveHandler', () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it('他ユーザーのミーティングは403で拒否すること', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { meetingId: 'm1', hostUserId: 'other-user', platform: 'recall', status: 'active' },
    });

    const event = {
      pathParameters: { meetingId: 'm1' },
      requestContext: {
        authorizer: { jwt: { claims: { sub: 'user-123' } } },
      },
    } as unknown as APIGatewayProxyEventV2;

    const response = await leaveHandler(event);
    expect(response.statusCode).toBe(403);
  });
});

// =============================================
// listHandler テスト
// =============================================
describe('recallMeetings - listHandler', () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  const makeAuthEvent = (extra?: object) => ({
    queryStringParameters: {},
    requestContext: {
      authorizer: {
        jwt: { claims: { sub: 'user-123' } },
      },
    },
    ...extra,
  }) as unknown as APIGatewayProxyEventV2;

  it('認証がない場合は401を返すこと', async () => {
    const event = {
      queryStringParameters: {},
      requestContext: {},
    } as unknown as APIGatewayProxyEventV2;

    const response = await listHandler(event);
    expect(response.statusCode).toBe(401);
  });

  describe('hostUserId-createdAt-index GSI クエリ', () => {
    it('createdAtの降順でユーザーの会議を取得すること', async () => {
      const now = Date.now();
      const meetings = [
        { meetingId: 'm1', hostUserId: 'user-123', createdAt: now - 2000, platform: 'recall', status: 'active' },
        { meetingId: 'm2', hostUserId: 'user-123', createdAt: now - 1000, platform: 'recall', status: 'active' },
        { meetingId: 'm3', hostUserId: 'user-123', createdAt: now, platform: 'recall', status: 'active' },
      ];

      ddbMock.on(QueryCommand).resolves({
        Items: [...meetings].reverse(), // DynamoDB returns in descending order
        Count: 3,
      });

      const response = await listHandler(makeAuthEvent());

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.meetings[0].meetingId).toBe('m3');
      expect(body.meetings[1].meetingId).toBe('m2');
      expect(body.meetings[2].meetingId).toBe('m1');

      const queryCall = ddbMock.commandCalls(QueryCommand)[0];
      expect(queryCall.args[0].input.IndexName).toBe('hostUserId-createdAt-index');
      expect(queryCall.args[0].input.KeyConditionExpression).toContain('hostUserId');
      expect(queryCall.args[0].input.ScanIndexForward).toBe(false);
    });

    it('limit パラメータを正しく処理すること', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [], Count: 0 });

      const event = makeAuthEvent({ queryStringParameters: { limit: '10' } });
      await listHandler(event);

      const queryCall = ddbMock.commandCalls(QueryCommand)[0];
      expect(queryCall.args[0].input.Limit).toBe(10);
    });

    it('nextToken を正しくエンコード/デコードすること', async () => {
      const lastKey = { meetingId: 'm10', hostUserId: 'user-123', createdAt: 1234567890 };

      ddbMock.on(QueryCommand).resolves({
        Items: [{ meetingId: 'm1', hostUserId: 'user-123', createdAt: Date.now(), platform: 'recall', status: 'active' }],
        LastEvaluatedKey: lastKey,
      });

      const response = await listHandler(makeAuthEvent());
      const body = JSON.parse(response.body);

      expect(body.nextToken).toBeDefined();
      const decodedKey = JSON.parse(Buffer.from(body.nextToken, 'base64').toString('utf-8'));
      expect(decodedKey).toEqual(lastKey);
    });
  });
});
