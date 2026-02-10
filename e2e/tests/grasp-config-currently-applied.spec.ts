import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import {
  clearLocalStackData,
  loadDefaultDataOnLocalStack,
  createMeeting,
  saveGraspConfigVersions,
  applyConfigToMeeting,
  openGraspConfigTab,
} from './helpers/grasp-config-helpers';

/**
 * E2Eテスト: 「現在適用中」表示と過去バージョンの自動展開
 *
 * このテストは新しい「現在適用中」表示機能をカバーします：
 * 1. 一覧上で現在適用中の設定に「現在適用中」テキストが表示される
 * 2. 過去バージョンが適用されている場合、バージョン一覧が自動展開される
 * 3. 過去バージョンに「現在適用中」表示がある
 *
 * 前提条件:
 * - docker-compose up -d ですべてのサービスが起動している
 * - pnpm run local:setup でLocalStackリソースが作成されている
 * - web/facilitator で pnpm run dev が起動している（ポート3001）
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

test.describe('「現在適用中」表示と自動展開', { tag: '@local' }, () => {
  test.setTimeout(120000); // 2分のタイムアウト

  test.beforeEach(async () => {
    clearLocalStackData();
    loadDefaultDataOnLocalStack(__dirname);
  });

  test('最新バージョンが適用されている場合、「現在適用中」が表示される', async ({ page }) => {
    console.log('事前準備: 会議とGrasp設定を作成');
    const meetingId = await createMeeting(page);

    const configName = '現在適用中テスト';
    const [configId] = await saveGraspConfigVersions(page, configName, 1);
    await applyConfigToMeeting(page, meetingId, configId);

    console.log('Step 1: Grasp設定タブを開く');
    await openGraspConfigTab(page);

    console.log('Step 2: 一覧上で「現在適用中」が表示される');
    const configGroup = page.locator(`[data-testid="config-group-${configName}"]`);
    await expect(configGroup).toBeVisible();

    const currentlyAppliedBadge = configGroup.locator('[data-testid="currently-applied-badge"]');
    await expect(currentlyAppliedBadge).toBeVisible({ timeout: 5000 });

    const badgeText = await currentlyAppliedBadge.textContent();
    expect(badgeText).toBe('現在適用中');

    console.log('  ✓ 「現在適用中」テキストが表示されている');
    console.log('✅ テスト完了！');
  });

  test('過去バージョンが適用されている場合、自動展開されて「現在適用中」が表示される', async ({ page }) => {
    console.log('事前準備: 会議と複数バージョンのGrasp設定を作成');
    const meetingId = await createMeeting(page);

    const configName = '過去バージョン適用テスト';
    const [v1Id, v2Id] = await saveGraspConfigVersions(page, configName, 2);

    // バージョン1（過去バージョン）を会議に適用
    await applyConfigToMeeting(page, meetingId, v1Id);
    console.log('  過去バージョン（v1）を会議に適用');

    console.log('Step 1: Grasp設定タブを開く');
    await openGraspConfigTab(page);

    console.log('Step 2: バージョン一覧が自動展開されている');
    // 過去バージョンのボタンが表示されていれば、自動展開されている
    const v1Button = page.locator(`[data-testid="config-version-${v1Id}"]`);
    await expect(v1Button).toBeVisible({ timeout: 5000 });

    console.log('  ✓ バージョン一覧が自動展開されている');

    console.log('Step 3: 過去バージョンに「現在適用中」が表示される');
    const v1Badge = v1Button.locator('[data-testid="currently-applied-badge"]');
    await expect(v1Badge).toBeVisible();

    const badgeText = await v1Badge.textContent();
    expect(badgeText).toBe('現在適用中');

    console.log('  ✓ 過去バージョンに「現在適用中」が表示されている');

    console.log('Step 4: 最新バージョンには「現在適用中」が表示されない');
    const v2Button = page.locator(`[data-testid="config-version-${v2Id}"]`);
    await expect(v2Button).toBeVisible();

    const v2Badge = v2Button.locator('[data-testid="currently-applied-badge"]');
    await expect(v2Badge).not.toBeVisible();

    console.log('  ✓ 最新バージョンには「現在適用中」が表示されていない');
    console.log('✅ テスト完了！');
  });

  test('最新バージョンが適用されている場合、バージョン一覧は自動展開されない', async ({ page }) => {
    console.log('事前準備: 会議と複数バージョンのGrasp設定を作成');
    const meetingId = await createMeeting(page);

    const configName = '最新バージョン適用テスト';
    const [v1Id, v2Id] = await saveGraspConfigVersions(page, configName, 2);

    // バージョン2（最新）を会議に適用
    await applyConfigToMeeting(page, meetingId, v2Id);
    console.log('  最新バージョン（v2）を会議に適用');

    console.log('Step 1: Grasp設定タブを開く');
    await openGraspConfigTab(page);

    console.log('Step 2: バージョン一覧は自動展開されていない');
    // 過去バージョンのボタンが表示されていなければ、展開されていない
    const v1Button = page.locator(`[data-testid="config-version-${v1Id}"]`);

    // 最初は展開されていないはず
    const isV1Visible = await v1Button.isVisible().catch(() => false);
    expect(isV1Visible).toBe(false);

    console.log('  ✓ 過去バージョンは最初は表示されていない（自動展開されていない）');

    console.log('Step 3: 展開ボタンをクリックすると過去バージョンが表示される');
    const expandButton = page.locator(`[data-testid="expand-versions-button-${configName}"]`);
    await expect(expandButton).toBeVisible();
    await expandButton.click();

    await expect(v1Button).toBeVisible({ timeout: 5000 });

    console.log('  ✓ 展開ボタンで過去バージョンが表示される');
    console.log('✅ テスト完了！');
  });

  test('適用を変更すると「現在適用中」表示も更新される', async ({ page }) => {
    console.log('事前準備: 会議と複数のGrasp設定を作成');
    const meetingId = await createMeeting(page);

    const config1Name = '設定A';
    const [config1Id] = await saveGraspConfigVersions(page, config1Name, 1);

    const config2Name = '設定B';
    const [config2Id] = await saveGraspConfigVersions(page, config2Name, 1);

    // 最初は設定Aを適用
    await applyConfigToMeeting(page, meetingId, config1Id);
    console.log('  設定Aを会議に適用');

    console.log('Step 1: Grasp設定タブを開く');
    await openGraspConfigTab(page);

    console.log('Step 2: 設定Aに「現在適用中」が表示される');
    const config1Group = page.locator(`[data-testid="config-group-${config1Name}"]`);
    const config1Badge = config1Group.locator('[data-testid="currently-applied-badge"]');
    await expect(config1Badge).toBeVisible();

    console.log('  ✓ 設定Aに「現在適用中」が表示されている');

    console.log('Step 3: 設定Bを選択して適用');
    const config2Button = page.locator(`[data-testid="config-version-${config2Id}"]`);
    await config2Button.click();

    const applyButton = page.locator('[data-testid="apply-config-button"]');
    await applyButton.click();

    const applySuccessMessage = page.locator('[data-testid="apply-success-message"]');
    await expect(applySuccessMessage).toBeVisible({ timeout: 10000 });

    console.log('  ✓ 設定Bを適用');

    console.log('Step 4: 「現在適用中」が設定Bに移動している');
    await page.waitForTimeout(1000); // 状態更新を待つ

    // 設定Aからバッジが消えている
    await expect(config1Badge).not.toBeVisible();

    // 設定Bにバッジが表示されている
    const config2Group = page.locator(`[data-testid="config-group-${config2Name}"]`);
    const config2Badge = config2Group.locator('[data-testid="currently-applied-badge"]');
    await expect(config2Badge).toBeVisible();

    console.log('  ✓ 「現在適用中」が設定Bに表示されている');
    console.log('✅ テスト完了！');
  });
});
