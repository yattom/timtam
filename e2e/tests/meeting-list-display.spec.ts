import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { loadDefaultDataOnLocalStack } from './helpers/grasp-config-helpers';

/**
 * E2Eテスト: 会議リスト表示のUIテスト
 *
 * このテストはFacilitator UIでの会議リスト表示を確認します：
 * 1. 会議が0件の場合の表示
 * 2. 会議が1件の場合の表示
 *
 * 前提条件:
 * - docker-compose up -d ですべてのサービスが起動している
 * - pnpm run local:setup でLocalStackリソースが作成されている
 * - web/facilitator で pnpm run dev が起動している（ポート3001）
 */

const FACILITATOR_URL = process.env.FACILITATOR_URL || 'http://localhost:3001';
const LOCALSTACK_ENDPOINT = process.env.LOCALSTACK_ENDPOINT || 'http://localhost:4566';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// LocalStack DynamoDB client
const ddbClient = new DynamoDBClient({
  endpoint: LOCALSTACK_ENDPOINT,
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

test.describe('会議リスト表示', { tag: '@local' }, () => {
  test.setTimeout(60000); // 1分のタイムアウト

  // 各テストケースの前にDynamoDBテーブルとSQSキューのデータをクリア
  test.beforeEach(async () => {
    console.log('Clearing LocalStack data...');
    execSync('uv run invoke delete-localstack-data', {
      stdio: 'inherit',
    });
    console.log('LocalStack data cleared');
    loadDefaultDataOnLocalStack(__dirname);
  });

  test('会議が0件の場合、適切なメッセージが表示されること', async ({ page }) => {
    // Facilitator UIにアクセス
    await page.goto(FACILITATOR_URL);
    await page.waitForLoadState('networkidle');

    // 会議リストが空の場合のメッセージを確認
    const emptyMessage = page.locator('[data-testid="no-meetings-message"]');
    await expect(emptyMessage).toBeVisible();
    console.log('✓ 会議が0件の場合のメッセージが表示されている');

    // 「新しい会議に参加」リンクが表示されていることを確認
    const joinLink = page.locator('[data-testid="join-new-meeting-link"]');
    await expect(joinLink).toBeVisible();
  });

  test('会議が1件の場合、その会議が表示されること', async ({ page }) => {
    // DynamoDBに1件の会議データを作成
    const now = Date.now();
    const meetingId = 'test-meeting-001';
    const meetingCode = 'TEST01';

    await ddb.send(
      new PutCommand({
        TableName: 'timtam-meetings-metadata',
        Item: {
          meetingId,
          type: 'MEETING', // GSI用の固定パーティションキー
          platform: 'recall',
          status: 'active',
          createdAt: now,
          meetingCode,
          recallBot: {
            botId: meetingId,
            meetingUrl: 'http://localhost',
            platform: 'zoom',
            botName: 'Test Bot',
            status: 'in_call',
            statusMessage: 'Test meeting',
          },
        },
      })
    );

    console.log('✓ テスト用の会議データを作成:', { meetingId, meetingCode });

    // Facilitator UIにアクセス
    await page.goto(FACILITATOR_URL);
    await page.waitForLoadState('networkidle');

    // 会議リストに1件の会議が表示されることを確認
    const meetingItems = page.locator('[data-testid="meeting-item"]');
    await expect(meetingItems).toHaveCount(1, { timeout: 10000 });

    // 会議コードが表示されていることを確認
    await expect(meetingItems.first()).toContainText(meetingCode, { timeout: 5000 });

    console.log('✓ 会議が1件表示されている');
  });

  test('会議が複数件ある場合、最新の会議が先頭に表示されること', async ({ page }) => {
    // DynamoDBに3件の会議データを作成（異なる作成時刻）
    const now = Date.now();
    const meetings = [
      {
        meetingId: 'meeting-old',
        meetingCode: 'OLD001',
        createdAt: now - 3000,
      },
      {
        meetingId: 'meeting-middle',
        meetingCode: 'MID001',
        createdAt: now - 2000,
      },
      {
        meetingId: 'meeting-new',
        meetingCode: 'NEW001',
        createdAt: now - 1000,
      },
    ];

    for (const meeting of meetings) {
      await ddb.send(
        new PutCommand({
          TableName: 'timtam-meetings-metadata',
          Item: {
            meetingId: meeting.meetingId,
            type: 'MEETING',
            platform: 'recall',
            status: 'active',
            createdAt: meeting.createdAt,
            meetingCode: meeting.meetingCode,
            recallBot: {
              botId: meeting.meetingId,
              meetingUrl: 'http://localhost',
              platform: 'zoom',
              botName: 'Test Bot',
              status: 'in_call',
              statusMessage: 'Test meeting',
            },
          },
        })
      );
    }

    console.log('✓ テスト用の会議データを3件作成');

    // Facilitator UIにアクセス
    await page.goto(FACILITATOR_URL);
    await page.waitForLoadState('networkidle');

    // 会議リストに3件の会議が表示されることを確認
    const meetingItems = page.locator('[data-testid="meeting-item"]');
    await expect(meetingItems).toHaveCount(3, { timeout: 10000 });

    // 最初の会議アイテムに最新の会議コードが含まれることを確認
    const firstMeetingItem = meetingItems.first();
    await expect(firstMeetingItem).toContainText('NEW001', { timeout: 5000 });

    console.log('✓ 最新の会議が先頭に表示されている');
  });
});
