import { Page, expect } from '@playwright/test';
import { execSync } from 'child_process';

export const FACILITATOR_URL = process.env.FACILITATOR_URL || 'http://localhost:3001';
export const API_URL = process.env.API_URL || 'http://localhost:3000';

/**
 * LocalStackデータをクリアする
 */
export function clearLocalStackData() {
  console.log('Clearing LocalStack data...');
  execSync('uv run invoke delete-localstack-data', {
    stdio: 'inherit',
  });
  console.log('LocalStack data cleared');
}

/**
 * 新しい会議を作成し、会議IDを返す
 */
export async function createMeeting(page: Page): Promise<string> {
  console.log('会議を作成中...');

  await page.goto(FACILITATOR_URL);
  await page.waitForLoadState('networkidle');

  // 新しい会議に参加
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

  // 会議詳細ページに遷移
  await page.waitForURL('**/meetings/detail?id=*', { timeout: 30000 });

  const url = new URL(page.url());
  const meetingId = url.searchParams.get('id');

  if (!meetingId) {
    throw new Error('会議IDが取得できませんでした');
  }

  console.log(`  会議ID: ${meetingId}`);

  // ボット退出ボタンが表示されることを確認（参加完了の証拠）
  await expect(page.locator('[data-testid="leave-meeting-button"]')).toBeVisible({ timeout: 10000 });

  return meetingId;
}

/**
 * Grasp設定をAPI経由で保存する
 */
export async function saveGraspConfig(
  page: Page,
  name: string,
  yaml: string
): Promise<string> {
  const response = await page.evaluate(
    async ({ apiUrl, name, yaml }) => {
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
    },
    { apiUrl: API_URL, name, yaml }
  );

  const configId = response.configId;
  console.log(`  Grasp設定を保存: ${name} (ID: ${configId})`);
  return configId;
}

/**
 * Grasp設定を会議に適用する
 */
export async function applyConfigToMeeting(
  page: Page,
  meetingId: string,
  configId: string
): Promise<void> {
  await page.evaluate(
    async ({ apiUrl, meetingId, configId }) => {
      await fetch(`${apiUrl}/meetings/${meetingId}/grasp-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configId }),
      });
    },
    { apiUrl: API_URL, meetingId, configId }
  );

  console.log(`  Grasp設定を会議に適用: ${configId}`);
}

/**
 * 会議の現在のGrasp設定を取得する
 */
export async function getMeetingConfig(
  page: Page,
  meetingId: string
): Promise<any> {
  const config = await page.evaluate(
    async ({ apiUrl, meetingId }) => {
      const response = await fetch(`${apiUrl}/meetings/${meetingId}/grasp-config`);
      return response.json();
    },
    { apiUrl: API_URL, meetingId }
  );

  return config;
}

/**
 * Grasp設定タブを開く
 */
export async function openGraspConfigTab(page: Page): Promise<void> {
  const configTab = page.locator('[data-testid="config-tab"]');
  await expect(configTab).toBeVisible({ timeout: 5000 });
  await configTab.click();
  await page.waitForTimeout(2000); // タブの内容がロードされるまで待つ
}

/**
 * テスト用のサンプルYAML設定を生成する
 */
export function createSampleYaml(version: number): string {
  return `grasps:
  - nodeId: test-grasp-v${version}
    promptTemplate: |
      これはテスト用のGrasp設定です（バージョン${version}）
    intervalSec: ${30 * version}
    outputHandler: chat`;
}
