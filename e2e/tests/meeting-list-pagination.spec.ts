import { test, expect } from '@playwright/test';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { execSync } from 'child_process';

/**
 * E2Eテスト: 会議一覧のページネーション問題を再現
 *
 * Issue #107: 最新の会議がダッシュボードに表示されない問題
 *
 * このテストは以下を確認する：
 * 1. 55件の会議データを作成（Limit 50を超える）
 * 2. API GET /recall/meetings を呼び出し
 * 3. 1ページ目（デフォルトLimit 50）のレスポンスに最新の会議が含まれない
 *
 * 期待される結果:
 * - テストは**FAIL**する（問題を再現）
 * - 修正後にこのテストが**PASS**することで、問題が解決したことを確認
 */

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const MEETINGS_METADATA_TABLE = 'timtam-meetings-metadata';

// LocalStack DynamoDBクライアントの設定
const ddbClient = new DynamoDBClient({
  endpoint: 'http://localhost:4566',
  region: 'ap-northeast-1',
  credentials: {
    accessKeyId: 'test',
    secretAccessKey: 'test',
  },
});

const ddb = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

/**
 * DynamoDBに会議データを直接作成するヘルパー関数
 */
async function createMeetingInDynamoDB(meetingId: string, createdAt: number) {
  await ddb.send(
    new PutCommand({
      TableName: MEETINGS_METADATA_TABLE,
      Item: {
        meetingId,
        type: 'MEETING', // Fixed partition key for createdAt-index GSI (Issue #107)
        platform: 'recall',
        status: 'active',
        createdAt,
        meetingCode: generateRandomCode(),
        recallBot: {
          botId: meetingId,
          meetingUrl: 'http://localhost',
          platform: 'zoom',
          botName: 'Test Bot',
          status: 'in_call',
        },
      },
    })
  );
}

/**
 * ランダムな6桁の会議コードを生成
 */
function generateRandomCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

test.describe('会議一覧のページネーション問題（Issue #107）', () => {
  test.setTimeout(120000); // 2分のタイムアウト

  test.beforeEach(async () => {
    console.log('Clearing LocalStack data...');
    execSync('uv run invoke delete-localstack-data', {
      stdio: 'inherit',
    });
    console.log('LocalStack data cleared');
  });

  test('最新の会議が1ページ目に表示されない問題を再現', async () => {
    console.log('========================================');
    console.log('Step 1: 55件の会議データを作成');
    console.log('========================================');

    const now = Date.now();
    const meetingIds: string[] = [];

    // 55件の会議を作成（古い順に作成）
    for (let i = 0; i < 55; i++) {
      const meetingId = `test-meeting-${String(i).padStart(3, '0')}`;
      const createdAt = now - (55 - i) * 60000; // 1分ごとに古くなる
      meetingIds.push(meetingId);
      await createMeetingInDynamoDB(meetingId, createdAt);
    }

    console.log(`  ✓ 55件の会議を作成しました`);
    console.log(`  最古の会議: ${meetingIds[0]}`);
    console.log(`  最新の会議: ${meetingIds[54]}`);

    // 最新の会議ID（テスト対象）
    const latestMeetingId = meetingIds[54];

    console.log('');
    console.log('========================================');
    console.log('Step 2: API GET /recall/meetings を呼び出し（1ページ目のみ）');
    console.log('========================================');

    const response = await fetch(`${API_BASE_URL}/recall/meetings`);
    expect(response.ok).toBe(true);

    const data = await response.json();
    console.log(`  取得した会議数: ${data.meetings?.length || 0}`);
    console.log(`  nextToken: ${data.nextToken ? 'あり' : 'なし'}`);

    console.log('');
    console.log('========================================');
    console.log('Step 3: 最新の会議が1ページ目に含まれるか確認');
    console.log('========================================');

    const meetings = data.meetings || [];
    const foundLatest = meetings.some((m: any) => m.meetingId === latestMeetingId);

    console.log(`  最新の会議（${latestMeetingId}）が1ページ目に含まれるか: ${foundLatest ? 'YES' : 'NO'}`);

    if (meetings.length > 0) {
      console.log(`  1ページ目の先頭の会議ID: ${meetings[0].meetingId}`);
      console.log(`  1ページ目の先頭の会議作成日時: ${meetings[0].createdAt}`);
    }

    console.log('');
    console.log('========================================');
    console.log('検証結果');
    console.log('========================================');

    // 最新の会議が1ページ目に含まれることを期待
    // 現在の実装ではこのアサーションは**FAIL**する（問題を再現）
    expect(foundLatest).toBe(true);

    console.log('  ✓ 最新の会議が1ページ目に表示されました');
  });
});
