import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';

/**
 * E2Eテスト: Grasp設定のエラーハンドリング
 *
 * このテストは、Grasp設定の代表的なバリデーションエラー
 * （例: 無効なYAML形式、必須フィールドの欠落 など）が
 * 正しく報告されることを確認します。
 *
 * 前提条件:
 * - docker-compose up -d ですべてのサービスが起動している
 * - pnpm run local:setup でLocalStackリソースが作成されている
 * - web/facilitator で pnpm run dev が起動している（ポート3001）
 */

const FACILITATOR_URL = process.env.FACILITATOR_URL || 'http://localhost:3001';
const API_URL = process.env.API_URL || 'http://localhost:3000';

// メッセージAPIポーリング設定
const MESSAGE_POLL_MAX_ATTEMPTS = 10;
const MESSAGE_POLL_INTERVAL_MS = 1000;

interface AiMessage {
  timestamp: number;
  message: string;
  type: string;
}

test.describe('Grasp設定のエラーハンドリング', { tag: '@local' }, () => {
  test.setTimeout(120000); // 2分のタイムアウト

  // 各テストケースの前にDynamoDBテーブルとSQSキューのデータをクリア
  test.beforeEach(async () => {
    console.log('Clearing LocalStack data...');
    execSync('uv run invoke delete-localstack-data', {
      stdio: 'inherit',
    });
    console.log('LocalStack data cleared');
  });

  test('無効なYAML形式のエラーがAPI層で検出される', async ({ page }) => {
    // 会議を作成
    await page.goto(FACILITATOR_URL);
    await page.waitForLoadState('networkidle');

    const joinLink = page.locator('[data-testid="join-new-meeting-link"]');
    await expect(joinLink).toBeVisible({ timeout: 10000 });
    await joinLink.click();

    await page.waitForURL('**/meetings/join');

    const meetingUrlInput = page.locator('[data-testid="meeting-url-input"]');
    await expect(meetingUrlInput).toBeVisible({ timeout: 5000 });
    await meetingUrlInput.fill('http://localhost');

    const joinButton = page.locator('[data-testid="join-meeting-button"]');
    await expect(joinButton).toBeEnabled({ timeout: 5000 });
    await joinButton.click();

    await page.waitForURL('**/meetings/detail?id=*', { timeout: 30000 });

    const url = new URL(page.url());
    const meetingId = url.searchParams.get('id');

    if (!meetingId) {
      throw new Error('会議IDが取得できませんでした');
    }

    console.log(`会議ID: ${meetingId}`);

    // ボット参加完了を確認
    await expect(page.locator('[data-testid="leave-meeting-button"]')).toBeVisible({ timeout: 10000 });

    // 無効なYAMLを含む設定を作成
    const invalidYaml = `
grasps:
  - nodeId: test-grasp
    promptTemplate: "test"
    intervalSec: 30
    outputHandler: chat
    invalid_indentation`;

    const configName = '無効YAML設定';

    // API経由で設定を保存しようとする（バリデーションで失敗するはず）
    const saveResult = await page.evaluate(async ({ apiUrl, name, yaml }) => {
      try {
        const response = await fetch(`${apiUrl}/grasp/configs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            yaml,
            createdAt: Date.now(),
          }),
        });
        const data = await response.json();
        return { ok: response.ok, data };
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    }, { apiUrl: API_URL, name: configName, yaml: invalidYaml });

    // APIレベルでエラーが返されることを確認
    expect(saveResult.ok).toBe(false);
    console.log('✓ 無効なYAML形式でバリデーションエラーが返された');
  });

  test('必須フィールド欠落のエラーがAPI層で検出される', async ({ page }) => {
    // 会議を作成
    await page.goto(FACILITATOR_URL);
    await page.waitForLoadState('networkidle');

    const joinLink = page.locator('[data-testid="join-new-meeting-link"]');
    await expect(joinLink).toBeVisible({ timeout: 10000 });
    await joinLink.click();

    await page.waitForURL('**/meetings/join');

    const meetingUrlInput = page.locator('[data-testid="meeting-url-input"]');
    await expect(meetingUrlInput).toBeVisible({ timeout: 5000 });
    await meetingUrlInput.fill('http://localhost');

    const joinButton = page.locator('[data-testid="join-meeting-button"]');
    await expect(joinButton).toBeEnabled({ timeout: 5000 });
    await joinButton.click();

    await page.waitForURL('**/meetings/detail?id=*', { timeout: 30000 });

    const url = new URL(page.url());
    const meetingId = url.searchParams.get('id');

    if (!meetingId) {
      throw new Error('会議IDが取得できませんでした');
    }

    console.log(`会議ID: ${meetingId}`);

    // ボット参加完了を確認
    await expect(page.locator('[data-testid="leave-meeting-button"]')).toBeVisible({ timeout: 10000 });

    // nodeIdが欠落した設定
    const invalidYaml = `
grasps:
  - promptTemplate: "test"
    intervalSec: 30
    outputHandler: chat`;

    const configName = 'nodeId欠落設定';

    // API経由で設定を保存しようとする
    const saveResult = await page.evaluate(async ({ apiUrl, name, yaml }) => {
      try {
        const response = await fetch(`${apiUrl}/grasp/configs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            yaml,
            createdAt: Date.now(),
          }),
        });
        const data = await response.json();
        return { ok: response.ok, data };
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    }, { apiUrl: API_URL, name: configName, yaml: invalidYaml });

    // APIレベルでエラーが返されることを確認
    expect(saveResult.ok).toBe(false);
    expect(saveResult.data.error).toContain('nodeId');
    console.log('✓ 必須フィールド欠落でバリデーションエラーが返された');
  });

  test('参照されないnoteTagのエラーがチャットに報告される', async ({ page }) => {
    // 会議を作成
    await page.goto(FACILITATOR_URL);
    await page.waitForLoadState('networkidle');

    const joinLink = page.locator('[data-testid="join-new-meeting-link"]');
    await expect(joinLink).toBeVisible({ timeout: 10000 });
    await joinLink.click();

    await page.waitForURL('**/meetings/join');

    const meetingUrlInput = page.locator('[data-testid="meeting-url-input"]');
    await expect(meetingUrlInput).toBeVisible({ timeout: 5000 });
    await meetingUrlInput.fill('http://localhost');

    const joinButton = page.locator('[data-testid="join-meeting-button"]');
    await expect(joinButton).toBeEnabled({ timeout: 5000 });
    await joinButton.click();

    await page.waitForURL('**/meetings/detail?id=*', { timeout: 30000 });

    const url = new URL(page.url());
    const meetingId = url.searchParams.get('id');

    if (!meetingId) {
      throw new Error('会議IDが取得できませんでした');
    }

    console.log(`会議ID: ${meetingId}`);

    // ボット参加完了を確認
    await expect(page.locator('[data-testid="leave-meeting-button"]')).toBeVisible({ timeout: 10000 });

    // noteTagが参照されていない設定（orchestratorでエラーになる）
    const invalidYaml = `
grasps:
  - nodeId: writer
    promptTemplate: "write something"
    intervalSec: 30
    outputHandler: note
    noteTag: unused-tag`;

    const configName = '参照されないnoteTag設定';

    // 設定を保存（API層のバリデーションは通過する）
    const saveResult = await page.evaluate(async ({ apiUrl, name, yaml }) => {
      const response = await fetch(`${apiUrl}/grasp/configs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          yaml,
          createdAt: Date.now(),
        }),
      });
      return response.json();
    }, { apiUrl: API_URL, name: configName, yaml: invalidYaml });

    const configId = saveResult.configId;
    console.log(`設定ID: ${configId}`);

    // 会議に適用しようとする（orchestratorでエラーになる）
    await page.evaluate(async ({ apiUrl, meetingId, configId }) => {
      await fetch(`${apiUrl}/meetings/${meetingId}/grasp-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configId }),
      });
    }, { apiUrl: API_URL, meetingId, configId });

    console.log('設定を会議に適用しようとした');

    // orchestratorがエラーメッセージをチャットに送信するまで待つ
    // messages APIをポーリングして、エラーメッセージが到達したことを確認する
    let errorMessageFound = false;
    
    for (let attempt = 0; attempt < MESSAGE_POLL_MAX_ATTEMPTS; attempt++) {
      await page.waitForTimeout(MESSAGE_POLL_INTERVAL_MS);
      
      const messages = await page.evaluate(async ({ apiUrl, meetingId }) => {
        const response = await fetch(`${apiUrl}/meetings/${meetingId}/messages`);
        const data = await response.json();
        return data.messages || [];
      }, { apiUrl: API_URL, meetingId });
      
      console.log(`ポーリング試行 ${attempt + 1}/${MESSAGE_POLL_MAX_ATTEMPTS}: ${messages.length}件のメッセージ`);
      
      // ai_interventionタイプのメッセージで「適用に失敗しました」を含むものを探す
      const errorMessage = (messages as AiMessage[]).find((msg) => 
        msg.type === 'ai_intervention' && 
        msg.message.includes('適用に失敗しました') &&
        msg.message.includes(configName)
      );
      
      if (errorMessage) {
        console.log(`✓ エラーメッセージを確認: ${errorMessage.message}`);
        errorMessageFound = true;
        
        // noteTagエラーの詳細も含まれていることを確認
        expect(errorMessage.message).toContain('unused-tag');
        break;
      }
    }
    
    expect(errorMessageFound).toBe(true);
    console.log('✓ orchestratorでのバリデーションエラーがチャットに報告された');
  });
});
