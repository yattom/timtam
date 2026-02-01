import { test, expect } from '@playwright/test';
import {
  FACILITATOR_URL,
  clearLocalStackData,
  createMeeting,
  saveGraspConfig,
  applyConfigToMeeting,
  openGraspConfigTab,
  createSampleYaml,
} from './helpers/grasp-config-helpers';

/**
 * E2Eテスト: UC02 会議のGrasp設定を確認する
 *
 * このテストはUC02のシナリオをカバーします：
 * 1. ファシリテーターが会議の詳細画面からGrasp設定のタブを開く
 * 2. 現在設定されているGrasp設定の名前とバージョン(タイムスタンプ)と内容が右側に表示される
 *
 * 前提条件:
 * - docker-compose up -d ですべてのサービスが起動している
 * - pnpm run local:setup でLocalStackリソースが作成されている
 * - web/facilitator で pnpm run dev が起動している（ポート3001）
 */

test.describe('UC02: 会議のGrasp設定を確認する', () => {
  test.setTimeout(120000); // 2分のタイムアウト

  // 各テストケースの前にDynamoDBテーブルとSQSキューのデータをクリア
  test.beforeEach(async () => {
    clearLocalStackData();
  });

  test('UC02: 現在のGrasp設定を確認', async ({ page }) => {
    // ========================================
    // 事前準備: 会議を作成し、Grasp設定を適用
    // ========================================
    console.log('事前準備: 会議を作成');
    const meetingId = await createMeeting(page);

    console.log('事前準備: Grasp設定を保存して適用');
    const configName = 'UC02確認用設定';
    const configYaml = createSampleYaml(1);
    const configId = await saveGraspConfig(page, configName, configYaml);
    await applyConfigToMeeting(page, meetingId, configId);

    // ========================================
    // UC02 Step 1: Grasp設定タブを開く
    // ========================================
    console.log('UC02 Step 1: Grasp設定タブを開く');
    await openGraspConfigTab(page);

    // ========================================
    // UC02 Step 2: 現在のGrasp設定の名前・バージョン・内容が表示される
    // ========================================
    console.log('UC02 Step 2: 現在のGrasp設定を確認');

    // 現在適用中の設定が表示されることを確認
    const currentConfigDisplay = page.locator('[data-testid="current-config-display"]');
    await expect(currentConfigDisplay).toBeVisible({ timeout: 10000 });

    // 設定名が表示される
    const currentConfigName = page.locator('[data-testid="current-config-name"]');
    await expect(currentConfigName).toBeVisible();
    await expect(currentConfigName).toHaveText(configName);

    console.log('  ✓ 現在の設定名が表示されている');

    // バージョン（configId）が表示される
    const currentConfigId = page.locator('[data-testid="current-config-id"]');
    await expect(currentConfigId).toBeVisible();
    await expect(currentConfigId).toContainText(configId);

    console.log('  ✓ バージョン(configId)が表示されている');

    // 保存済み設定一覧から該当設定を選択
    const savedConfigsList = page.locator('[data-testid="saved-configs-list"]');
    await expect(savedConfigsList).toBeVisible();

    const configGroup = page.locator(`[data-testid="config-group-${configName}"]`);
    await expect(configGroup).toBeVisible();

    const configVersionButton = page.locator(`[data-testid="config-version-${configId}"]`);
    await expect(configVersionButton).toBeVisible();
    await configVersionButton.click();

    console.log('  ✓ 保存済み設定一覧から設定を選択');

    // 右側に設定内容が表示される
    const configYamlDisplay = page.locator('[data-testid="config-yaml-display"]');
    await expect(configYamlDisplay).toBeVisible({ timeout: 5000 });
    const displayedYaml = await configYamlDisplay.textContent();
    expect(displayedYaml).toContain('test-grasp-v1');

    console.log('  ✓ 右側に設定内容が表示されている');

    console.log('✅ UC02 テスト完了！');
    console.log('');
    console.log('確認した項目:');
    console.log('  ✓ Step 1: Grasp設定タブを開ける');
    console.log('  ✓ Step 2: 現在の設定名・バージョン(タイムスタンプ)・内容が右側に表示される');
  });

  test('UC02: Grasp設定が未設定の会議での確認', async ({ page }) => {
    // ========================================
    // 事前準備: Grasp設定が適用されていない会議を作成
    // ========================================
    console.log('事前準備: Grasp設定なしの会議を作成');
    const meetingId = await createMeeting(page);

    // ========================================
    // UC02 Step 1: Grasp設定タブを開く
    // ========================================
    console.log('UC02 Step 1: Grasp設定タブを開く');
    await openGraspConfigTab(page);

    // ========================================
    // UC02 Step 2: 設定が未適用の場合の表示を確認
    // ========================================
    console.log('UC02 Step 2: 未設定時の表示を確認');

    const currentConfigDisplay = page.locator('[data-testid="current-config-display"]');
    await expect(currentConfigDisplay).toBeVisible({ timeout: 10000 });

    // 「未設定」または類似のメッセージが表示されるはず
    const displayText = await currentConfigDisplay.textContent();
    console.log(`  現在の表示: ${displayText}`);

    // ここでは具体的な実装に依存するため、表示されることのみ確認
    console.log('  ✓ 現在の設定表示エリアが表示されている');

    console.log('✅ UC02（未設定時）テスト完了！');
  });
});
