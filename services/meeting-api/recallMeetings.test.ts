import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
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

  describe('現在の実装（Scan使用）', () => {
    it('【失敗するべき】50件を超えるデータで最新の会議が取得できない', async () => {
      // Setup: 55件の会議データ
      const now = Date.now();
      const meetings = Array.from({ length: 55 }, (_, i) => ({
        meetingId: `meeting-${i.toString().padStart(3, '0')}`,
        createdAt: now - (54 - i) * 1000, // 最後のアイテムが最新
        platform: 'recall',
        status: 'active',
      }));

      // Mock Scan response: ランダムに50件を返す（最新を含まない）
      ddbMock.on(ScanCommand).resolves({
        Items: meetings.slice(0, 50), // 最初の50件のみ（最新5件を含まない）
        Count: 50,
        LastEvaluatedKey: { meetingId: 'meeting-049' },
      });

      const event = {
        queryStringParameters: {},
      } as unknown as APIGatewayProxyEventV2;

      const response = await listHandler(event);
      const body = JSON.parse(response.body);

      // 現在の実装では、クライアント側でソートしても
      // Scan で取得した50件の中に最新が含まれていない
      const returnedIds = body.meetings.map((m: any) => m.meetingId);

      // 最新の会議（meeting-054）が含まれていない
      expect(returnedIds).not.toContain('meeting-054');

      // この test は GSI 実装後に削除する
    });
  });
});
