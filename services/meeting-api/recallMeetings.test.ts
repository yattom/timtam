import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { listHandler } from './recallMeetings';
import { APIGatewayProxyEventV2 } from 'aws-lambda';

const ddbMock = mockClient(DynamoDBDocumentClient);

describe('recallMeetings - listHandler', () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  describe('GSI Query実装（修正後）', () => {
    it('createdAtの降順で会議を取得すること', async () => {
      // Setup: GSI with fixed partition key "MEETING" and createdAt sort key
      const now = Date.now();
      const meetings = [
        { meetingId: 'm1', type: 'MEETING', createdAt: now - 2000, platform: 'recall', status: 'active' },
        { meetingId: 'm2', type: 'MEETING', createdAt: now - 1000, platform: 'recall', status: 'active' },
        { meetingId: 'm3', type: 'MEETING', createdAt: now, platform: 'recall', status: 'active' },
      ];

      // Mock QueryCommand response (sorted by DynamoDB)
      ddbMock.on(QueryCommand).resolves({
        Items: [...meetings].reverse(), // DynamoDB returns in descending order
        Count: 3,
      });

      const event = {
        queryStringParameters: {},
      } as unknown as APIGatewayProxyEventV2;

      const response = await listHandler(event);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      // 最新の会議が先頭に来ること
      expect(body.meetings[0].meetingId).toBe('m3');
      expect(body.meetings[1].meetingId).toBe('m2');
      expect(body.meetings[2].meetingId).toBe('m1');

      // QueryCommand が使われていること
      const calls = ddbMock.commandCalls(QueryCommand);
      expect(calls.length).toBe(1);

      // GSI使用の確認
      const queryCall = calls[0];
      expect(queryCall.args[0].input.IndexName).toBe('createdAt-index');
      expect(queryCall.args[0].input.KeyConditionExpression).toContain('type');
      expect(queryCall.args[0].input.ScanIndexForward).toBe(false); // 降順
    });

    it('limit パラメータを正しく処理すること', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [],
        Count: 0,
      });

      const event = {
        queryStringParameters: { limit: '10' },
      } as unknown as APIGatewayProxyEventV2;

      await listHandler(event);

      const calls = ddbMock.commandCalls(QueryCommand);
      expect(calls[0].args[0].input.Limit).toBe(10);
    });

    it('nextToken を正しくエンコード/デコードすること', async () => {
      const lastKey = { meetingId: 'm10', type: 'MEETING', createdAt: 1234567890 };

      ddbMock.on(QueryCommand).resolves({
        Items: [{ meetingId: 'm1', type: 'MEETING', createdAt: Date.now(), platform: 'recall', status: 'active' }],
        LastEvaluatedKey: lastKey,
      });

      const event = {
        queryStringParameters: {},
      } as unknown as APIGatewayProxyEventV2;

      const response = await listHandler(event);
      const body = JSON.parse(response.body);

      // nextToken が返されること
      expect(body.nextToken).toBeDefined();

      // nextToken をデコードして元のキーと一致すること
      const decodedKey = JSON.parse(Buffer.from(body.nextToken, 'base64').toString('utf-8'));
      expect(decodedKey).toEqual(lastKey);
    });
  });
});
