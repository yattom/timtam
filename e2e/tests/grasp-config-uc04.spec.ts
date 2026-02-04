import { test, expect } from '@playwright/test';
import {
  FACILITATOR_URL,
  clearLocalStackData,
  saveGraspConfig,
  createSampleYaml,
} from './helpers/grasp-config-helpers';

/**
 * E2Eテスト: UC04 システムにGrasp設定を保存する
 *
 * このテストはUC04のシナリオをカバーします：
 * 1. ファシリテーターがダッシュボード (/) でGrasp設定を開く
 * 2. 現在保存されているGrasp設定の一覧が表示される
 * 3. Grasp設定の名前を選択すると、その内容も表示される。デフォルトは最新バージョン
 * 4. ファシリテーターがGrasp設定を更新して保存する。デフォルトでは変更前の名前が提示されるが、別の名前を付けてもよい
 * 5. システムは、名前とバージョン(タイムスタンプ)でGrasp設定を新規保存する
 * 6. 現在のGrasp設定一覧が、いま保存したものを含むよう更新される
 * 7. ここで保存したGrasp設定は、あとで会議詳細画面から選択できるようになる
 *
 * NOTE: ダッシュボードのGrasp設定画面では、進行中の会議に反映することはできない
 *
 * 前提条件:
 * - docker-compose up -d ですべてのサービスが起動している
 * - pnpm run local:setup でLocalStackリソースが作成されている
 * - web/facilitator で pnpm run dev が起動している（ポート3001）
 */

test.describe('UC04: システムにGrasp設定を保存する', { tag: '@local' }, () => {
  test.setTimeout(120000); // 2分のタイムアウト

  // 各テストケースの前にDynamoDBテーブルとSQSキューのデータをクリア
  test.beforeEach(async () => {
    clearLocalStackData();
  });

  test('UC04: ダッシュボードでGrasp設定を保存', async ({ page }) => {
    // ========================================
    // 事前準備: 既存のGrasp設定を保存
    // ========================================
    console.log('事前準備: 既存のGrasp設定を保存');

    const existingConfigName = 'UC04既存設定';
    const existingYaml = createSampleYaml(1);
    const existingConfigId = await saveGraspConfig(page, existingConfigName, existingYaml);

    console.log(`  既存設定を保存: ${existingConfigName} (ID: ${existingConfigId})`);

    // ========================================
    // UC04 Step 1: ダッシュボードでGrasp設定を開く
    // ========================================
    console.log('UC04 Step 1: ダッシュボードでGrasp設定を開く');

    await page.goto(FACILITATOR_URL);
    await page.waitForLoadState('networkidle');

    // Grasp設定ページへのリンクをクリック
    const configLink = page.locator('[data-testid="dashboard-config-link"]');
    await expect(configLink).toBeVisible({ timeout: 10000 });
    await configLink.click();

    await page.waitForURL('**/config', { timeout: 10000 });

    console.log('  ✓ Grasp設定ページに遷移');

    // ========================================
    // UC04 Step 2: 現在保存されているGrasp設定の一覧が表示される
    // ========================================
    console.log('UC04 Step 2: 保存済み設定の一覧が表示される');

    const savedConfigsList = page.locator('[data-testid="dashboard-saved-configs-list"]');
    await expect(savedConfigsList).toBeVisible({ timeout: 5000 });

    const configGroup = page.locator(`[data-testid="dashboard-config-group-${existingConfigName}"]`);
    await expect(configGroup).toBeVisible();

    console.log('  ✓ 既存設定が一覧に表示されている');

    // ========================================
    // UC04 Step 3: 設定を選択すると内容が表示される（最新バージョンがデフォルト）
    // ========================================
    console.log('UC04 Step 3: 設定を選択すると内容が表示される');

    const configVersionButton = page.locator(`[data-testid="dashboard-config-version-${existingConfigId}"]`);
    await expect(configVersionButton).toBeVisible();
    await configVersionButton.click();

    console.log('  ✓ 設定を選択');

    // 右側に内容が表示される
    const configYamlTextarea = page.locator('[data-testid="dashboard-config-yaml-textarea"]');
    await expect(configYamlTextarea).toBeVisible({ timeout: 5000 });

    const displayedYaml = await configYamlTextarea.inputValue();
    expect(displayedYaml).toContain('test-grasp-v1');

    console.log('  ✓ 右側に設定内容が表示されている');

    // ========================================
    // UC04 Step 4: Grasp設定を更新する（名前はデフォルトで既存名、変更可能）
    // ========================================
    console.log('UC04 Step 4: Grasp設定を更新');

    // 設定名入力フィールドの確認（デフォルトで既存名が入っているはず）
    const configNameInput = page.locator('[data-testid="dashboard-config-name-input"]');
    await expect(configNameInput).toBeVisible();
    const currentName = await configNameInput.inputValue();
    expect(currentName).toBe(existingConfigName);

    console.log('  ✓ 設定名はデフォルトで既存名が表示されている');

    // YAML内容を更新
    const updatedYaml = createSampleYaml(2);
    await configYamlTextarea.fill(updatedYaml);

    console.log('  ✓ YAML内容を更新');

    // 変更通知が表示されることを確認
    const yamlChangedNotice = page.locator('[data-testid="dashboard-yaml-changed-notice"]');
    await expect(yamlChangedNotice).toBeVisible({ timeout: 2000 });

    console.log('  ✓ 変更通知が表示されている');

    // ========================================
    // UC04 Step 5: 新バージョンとして保存
    // ========================================
    console.log('UC04 Step 5: 新バージョンとして保存');

    // 名前を付けて保存ボタンをクリック
    const saveButton = page.locator('[data-testid="dashboard-save-config-button"]');
    await expect(saveButton).toBeVisible();
    await saveButton.click();

    // 保存ダイアログが表示される
    const saveDialog = page.locator('[data-testid="dashboard-save-dialog"]');
    await expect(saveDialog).toBeVisible({ timeout: 2000 });

    // ダイアログ内の設定名入力欄（既存名がデフォルト）
    const dialogNameInput = page.locator('[data-testid="dashboard-save-dialog-name-input"]');
    await expect(dialogNameInput).toBeVisible();
    const dialogNameValue = await dialogNameInput.inputValue();
    expect(dialogNameValue).toBe(existingConfigName);

    console.log('  ✓ 保存ダイアログが表示され、既存名がデフォルト');

    // 保存確定
    const confirmSaveButton = page.locator('[data-testid="dashboard-confirm-save-button"]');
    await expect(confirmSaveButton).toBeVisible();
    await confirmSaveButton.click();

    // 保存成功メッセージ
    const saveSuccessMessage = page.locator('[data-testid="dashboard-save-success-message"]');
    await expect(saveSuccessMessage).toBeVisible({ timeout: 10000 });

    console.log('  ✓ 新バージョンとして保存成功');

    // ========================================
    // UC04 Step 6: 一覧が更新される
    // ========================================
    console.log('UC04 Step 6: 一覧が更新される');

    await page.waitForTimeout(2000); // 一覧更新を待つ

    // 設定グループがまだ表示されている
    await expect(configGroup).toBeVisible();

    // バージョン展開ボタンが表示される（複数バージョンが存在する証拠）
    const expandButton = page.locator(`[data-testid="dashboard-expand-versions-button-${existingConfigName}"]`);
    await expect(expandButton).toBeVisible({ timeout: 5000 });

    console.log('  ✓ 一覧が更新され、複数バージョンが存在することが確認できる');

    // ========================================
    // UC04 Step 7: 会議詳細画面から選択できる（ここでは保存を確認するのみ）
    // ========================================
    console.log('UC04 Step 7: 保存されたGrasp設定が将来選択可能になる');

    // ここでは保存されたことを確認（会議詳細画面からの選択は別のテストで確認）
    console.log('  ✓ 保存が完了し、将来会議詳細画面から選択可能');

    console.log('✅ UC04 テスト完了！');
    console.log('');
    console.log('確認した項目:');
    console.log('  ✓ Step 1: ダッシュボードでGrasp設定を開ける');
    console.log('  ✓ Step 2: 保存済み設定の一覧が表示される');
    console.log('  ✓ Step 3: 設定選択で内容が表示される（最新バージョンがデフォルト）');
    console.log('  ✓ Step 4: Grasp設定を更新（既存名がデフォルト、変更可能）');
    console.log('  ✓ Step 5: 名前とバージョン(タイムスタンプ)で新規保存');
    console.log('  ✓ Step 6: 一覧が更新される');
    console.log('  ✓ Step 7: 保存したGrasp設定が将来選択可能になる');
  });

  test('UC04: 名前を変更して保存', async ({ page }) => {
    // ========================================
    // 事前準備: 既存のGrasp設定を保存
    // ========================================
    console.log('事前準備: 既存のGrasp設定を保存');

    const existingConfigName = 'UC04元の設定';
    const existingYaml = createSampleYaml(1);
    const existingConfigId = await saveGraspConfig(page, existingConfigName, existingYaml);

    // ========================================
    // ダッシュボードで設定を開く
    // ========================================
    await page.goto(`${FACILITATOR_URL}/config`);
    await page.waitForLoadState('networkidle');

    // 設定を選択
    const configVersionButton = page.locator(`[data-testid="dashboard-config-version-${existingConfigId}"]`);
    await expect(configVersionButton).toBeVisible({ timeout: 10000 });
    await configVersionButton.click();

    // YAML内容を更新
    const configYamlTextarea = page.locator('[data-testid="dashboard-config-yaml-textarea"]');
    await expect(configYamlTextarea).toBeVisible({ timeout: 5000 });
    const updatedYaml = createSampleYaml(3);
    await configYamlTextarea.fill(updatedYaml);

    console.log('  ✓ YAML内容を更新');

    // 保存ボタンをクリック
    const saveButton = page.locator('[data-testid="dashboard-save-config-button"]');
    await saveButton.click();

    // ダイアログで名前を変更
    const saveDialog = page.locator('[data-testid="dashboard-save-dialog"]');
    await expect(saveDialog).toBeVisible({ timeout: 2000 });

    const dialogNameInput = page.locator('[data-testid="dashboard-save-dialog-name-input"]');
    const newConfigName = 'UC04新しい名前の設定';
    await dialogNameInput.fill(newConfigName);

    console.log('  ✓ 設定名を変更');

    // 保存確定
    const confirmSaveButton = page.locator('[data-testid="dashboard-confirm-save-button"]');
    await confirmSaveButton.click();

    // 保存成功
    const saveSuccessMessage = page.locator('[data-testid="dashboard-save-success-message"]');
    await expect(saveSuccessMessage).toBeVisible({ timeout: 10000 });

    console.log('  ✓ 新しい名前で保存成功');

    // 一覧に新しい名前の設定が追加されている
    await page.waitForTimeout(2000);

    const newConfigGroup = page.locator(`[data-testid="dashboard-config-group-${newConfigName}"]`);
    await expect(newConfigGroup).toBeVisible({ timeout: 5000 });

    console.log('  ✓ 一覧に新しい名前の設定が表示されている');

    console.log('✅ UC04（名前変更）テスト完了！');
  });

  test('UC04: ダッシュボードから会議に直接適用できないことを確認', async ({ page }) => {
    // ========================================
    // 事前準備
    // ========================================
    console.log('事前準備: Grasp設定を保存');

    const configName = 'UC04テスト設定';
    const configYaml = createSampleYaml(1);
    const configId = await saveGraspConfig(page, configName, configYaml);

    // ========================================
    // ダッシュボードで設定を開く
    // ========================================
    await page.goto(`${FACILITATOR_URL}/config`);
    await page.waitForLoadState('networkidle');

    // 設定を選択
    const configVersionButton = page.locator(`[data-testid="dashboard-config-version-${configId}"]`);
    await expect(configVersionButton).toBeVisible({ timeout: 10000 });
    await configVersionButton.click();

    // ========================================
    // UC04 NOTE: 「保存して適用」ボタンが存在しないこと
    // ========================================
    console.log('UC04 NOTE: ダッシュボードでは会議に適用できない');

    // 「保存して適用」ボタンが存在しないことを確認
    const saveAndApplyButton = page.locator('[data-testid="dashboard-save-and-apply-button"]');
    await expect(saveAndApplyButton).not.toBeVisible();

    console.log('  ✓ 「保存して適用」ボタンが存在しない');

    // 使い方の注意書きが表示されている
    const usageNote = page.getByText(/ダッシュボードでは進行中の会議に直接適用できない/);
    await expect(usageNote).toBeVisible({ timeout: 5000 });

    console.log('  ✓ ダッシュボードでは会議に適用できない旨が表示されている');

    console.log('✅ UC04（適用不可確認）テスト完了！');
  });
});
