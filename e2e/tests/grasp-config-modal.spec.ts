import { test, expect } from '@playwright/test';
import {
  clearLocalStackData,
  createMeeting,
  saveGraspConfig,
  applyConfigToMeeting,
  getMeetingConfig,
  openGraspConfigTab,
  createSampleYaml,
} from './helpers/grasp-config-helpers';

/**
 * E2Eテスト: モーダルでのGrasp設定編集
 *
 * このテストは新しいモーダルUI機能をカバーします：
 * 1. 編集ボタンをクリックするとモーダルが開く
 * 2. モーダル内でYAMLと設定名を編集できる
 * 3. 保存して適用ボタンで新バージョンとして保存され適用される
 * 4. 編集を破棄ボタンで確認ダイアログが表示され、編集が破棄される
 * 5. ESCキー、背景クリック、×ボタンでも編集を破棄できる
 * 6. 変更がない場合は確認ダイアログなしで閉じる
 *
 * 前提条件:
 * - docker-compose up -d ですべてのサービスが起動している
 * - pnpm run local:setup でLocalStackリソースが作成されている
 * - web/facilitator で pnpm run dev が起動している（ポート3001）
 */

test.describe('モーダルでのGrasp設定編集', { tag: '@local' }, () => {
  test.setTimeout(120000); // 2分のタイムアウト

  test.beforeEach(async () => {
    clearLocalStackData();
  });

  test('編集ボタンをクリックするとモーダルが開く', async ({ page }) => {
    console.log('事前準備: 会議とGrasp設定を作成');
    const meetingId = await createMeeting(page);

    const configName = 'モーダルテスト設定';
    const configYaml = createSampleYaml(1);
    const configId = await saveGraspConfig(page, configName, configYaml);
    await applyConfigToMeeting(page, meetingId, configId);

    console.log('Step 1: Grasp設定タブを開く');
    await openGraspConfigTab(page);

    console.log('Step 2: 設定を選択');
    const configVersionButton = page.locator(`[data-testid="config-version-${configId}"]`);
    await expect(configVersionButton).toBeVisible();
    await configVersionButton.click();

    console.log('Step 3: 編集ボタンをクリック');
    const editButton = page.locator('[data-testid="edit-button"]');
    await expect(editButton).toBeVisible();
    await editButton.click();

    console.log('Step 4: モーダルが表示されることを確認');
    const modalBackdrop = page.locator('[data-testid="modal-backdrop"]');
    await expect(modalBackdrop).toBeVisible({ timeout: 5000 });

    const modalYamlTextarea = page.locator('[data-testid="modal-yaml-textarea"]');
    await expect(modalYamlTextarea).toBeVisible();

    const modalSaveButton = page.locator('[data-testid="modal-save-and-apply-button"]');
    await expect(modalSaveButton).toBeVisible();

    const modalDiscardButton = page.locator('[data-testid="modal-discard-button"]');
    await expect(modalDiscardButton).toBeVisible();

    console.log('  ✓ モーダルが正しく表示されている');
    console.log('✅ テスト完了！');
  });

  test('モーダルで編集して保存すると新バージョンとして保存され適用される', async ({ page }) => {
    console.log('事前準備: 会議とGrasp設定を作成');
    const meetingId = await createMeeting(page);

    const configName = 'モーダル編集テスト';
    const configYaml = createSampleYaml(1);
    const configId = await saveGraspConfig(page, configName, configYaml);
    await applyConfigToMeeting(page, meetingId, configId);

    console.log('Step 1: Grasp設定タブを開いて設定を選択');
    await openGraspConfigTab(page);
    const configVersionButton = page.locator(`[data-testid="config-version-${configId}"]`);
    await configVersionButton.click();

    console.log('Step 2: 編集ボタンをクリックしてモーダルを開く');
    const editButton = page.locator('[data-testid="edit-button"]');
    await editButton.click();

    console.log('Step 3: YAMLを変更');
    const modalYamlTextarea = page.locator('[data-testid="modal-yaml-textarea"]');
    await expect(modalYamlTextarea).toBeVisible();

    const newYaml = createSampleYaml(99);
    await modalYamlTextarea.fill(newYaml);

    console.log('Step 4: 保存して適用');
    const modalSaveButton = page.locator('[data-testid="modal-save-and-apply-button"]');
    await modalSaveButton.click();

    console.log('Step 5: モーダルが閉じて適用成功メッセージが表示される');
    const modalBackdrop = page.locator('[data-testid="modal-backdrop"]');
    await expect(modalBackdrop).not.toBeVisible({ timeout: 5000 });

    const applySuccessMessage = page.locator('[data-testid="apply-success-message"]');
    await expect(applySuccessMessage).toBeVisible({ timeout: 10000 });

    console.log('Step 6: 新バージョンが会議に適用されている');
    await page.waitForTimeout(2000);
    const appliedConfig = await getMeetingConfig(page, meetingId);
    expect(appliedConfig.yaml).toContain('test-grasp-v99');

    console.log('  ✓ 新バージョンが保存され適用されている');
    console.log('✅ テスト完了！');
  });

  test('編集を破棄すると確認ダイアログが表示される', async ({ page }) => {
    console.log('事前準備: 会議とGrasp設定を作成');
    const meetingId = await createMeeting(page);

    const configName = '破棄テスト設定';
    const configYaml = createSampleYaml(1);
    const configId = await saveGraspConfig(page, configName, configYaml);
    await applyConfigToMeeting(page, meetingId, configId);

    console.log('Step 1: Grasp設定タブを開いて設定を選択');
    await openGraspConfigTab(page);
    const configVersionButton = page.locator(`[data-testid="config-version-${configId}"]`);
    await configVersionButton.click();

    console.log('Step 2: 編集ボタンをクリックしてモーダルを開く');
    const editButton = page.locator('[data-testid="edit-button"]');
    await editButton.click();

    console.log('Step 3: YAMLを変更');
    const modalYamlTextarea = page.locator('[data-testid="modal-yaml-textarea"]');
    await expect(modalYamlTextarea).toBeVisible();
    await modalYamlTextarea.fill(createSampleYaml(88));

    console.log('Step 4: 編集を破棄ボタンをクリック');

    // 確認ダイアログのハンドリング
    page.once('dialog', async dialog => {
      console.log('  ✓ 確認ダイアログが表示された');
      expect(dialog.type()).toBe('confirm');
      expect(dialog.message()).toContain('破棄');
      await dialog.accept();
    });

    const modalDiscardButton = page.locator('[data-testid="modal-discard-button"]');
    await modalDiscardButton.click();

    console.log('Step 5: モーダルが閉じる');
    const modalBackdrop = page.locator('[data-testid="modal-backdrop"]');
    await expect(modalBackdrop).not.toBeVisible({ timeout: 5000 });

    console.log('  ✓ 編集が破棄されてモーダルが閉じた');
    console.log('✅ テスト完了！');
  });

  test('変更がない場合は確認ダイアログなしで閉じる', async ({ page }) => {
    console.log('事前準備: 会議とGrasp設定を作成');
    const meetingId = await createMeeting(page);

    const configName = '無変更テスト設定';
    const configYaml = createSampleYaml(1);
    const configId = await saveGraspConfig(page, configName, configYaml);
    await applyConfigToMeeting(page, meetingId, configId);

    console.log('Step 1: Grasp設定タブを開いて設定を選択');
    await openGraspConfigTab(page);
    const configVersionButton = page.locator(`[data-testid="config-version-${configId}"]`);
    await configVersionButton.click();

    console.log('Step 2: 編集ボタンをクリックしてモーダルを開く');
    const editButton = page.locator('[data-testid="edit-button"]');
    await editButton.click();

    console.log('Step 3: YAMLを変更しない');
    await page.waitForTimeout(500);

    console.log('Step 4: 編集を破棄ボタンをクリック');

    // 確認ダイアログが表示されないことを確認
    let dialogShown = false;
    page.once('dialog', async dialog => {
      dialogShown = true;
      await dialog.dismiss();
    });

    const modalDiscardButton = page.locator('[data-testid="modal-discard-button"]');
    await modalDiscardButton.click();

    console.log('Step 5: 確認ダイアログなしでモーダルが閉じる');
    const modalBackdrop = page.locator('[data-testid="modal-backdrop"]');
    await expect(modalBackdrop).not.toBeVisible({ timeout: 5000 });

    expect(dialogShown).toBe(false);
    console.log('  ✓ 確認ダイアログなしで閉じた');
    console.log('✅ テスト完了！');
  });

  test('ESCキーで編集を破棄できる', async ({ page }) => {
    console.log('事前準備: 会議とGrasp設定を作成');
    await createMeeting(page);

    const configName = 'ESCキーテスト';
    const configYaml = createSampleYaml(1);
    const configId = await saveGraspConfig(page, configName, configYaml);

    console.log('Step 1: Grasp設定タブを開いて設定を選択');
    await openGraspConfigTab(page);
    const configVersionButton = page.locator(`[data-testid="config-version-${configId}"]`);
    await configVersionButton.click();

    console.log('Step 2: 編集ボタンをクリックしてモーダルを開く');
    const editButton = page.locator('[data-testid="edit-button"]');
    await editButton.click();

    console.log('Step 3: YAMLを変更');
    const modalYamlTextarea = page.locator('[data-testid="modal-yaml-textarea"]');
    await expect(modalYamlTextarea).toBeVisible();
    await modalYamlTextarea.fill(createSampleYaml(77));

    console.log('Step 4: ESCキーを押す');

    // 確認ダイアログのハンドリング
    page.once('dialog', async dialog => {
      console.log('  ✓ 確認ダイアログが表示された');
      await dialog.accept();
    });

    await page.keyboard.press('Escape');

    console.log('Step 5: モーダルが閉じる');
    const modalBackdrop = page.locator('[data-testid="modal-backdrop"]');
    await expect(modalBackdrop).not.toBeVisible({ timeout: 5000 });

    console.log('  ✓ ESCキーで編集が破棄された');
    console.log('✅ テスト完了！');
  });

  test('背景クリックで編集を破棄できる', async ({ page }) => {
    console.log('事前準備: 会議とGrasp設定を作成');
    await createMeeting(page);

    const configName = '背景クリックテスト';
    const configYaml = createSampleYaml(1);
    const configId = await saveGraspConfig(page, configName, configYaml);

    console.log('Step 1: Grasp設定タブを開いて設定を選択');
    await openGraspConfigTab(page);
    const configVersionButton = page.locator(`[data-testid="config-version-${configId}"]`);
    await configVersionButton.click();

    console.log('Step 2: 編集ボタンをクリックしてモーダルを開く');
    const editButton = page.locator('[data-testid="edit-button"]');
    await editButton.click();

    console.log('Step 3: YAMLを変更');
    const modalYamlTextarea = page.locator('[data-testid="modal-yaml-textarea"]');
    await expect(modalYamlTextarea).toBeVisible();
    await modalYamlTextarea.fill(createSampleYaml(66));

    console.log('Step 4: 背景をクリック');

    // 確認ダイアログのハンドリング
    page.once('dialog', async dialog => {
      console.log('  ✓ 確認ダイアログが表示された');
      await dialog.accept();
    });

    const modalBackdrop = page.locator('[data-testid="modal-backdrop"]');
    await modalBackdrop.click();

    console.log('Step 5: モーダルが閉じる');
    await expect(modalBackdrop).not.toBeVisible({ timeout: 5000 });

    console.log('  ✓ 背景クリックで編集が破棄された');
    console.log('✅ テスト完了！');
  });

  test('×ボタンで編集を破棄できる', async ({ page }) => {
    console.log('事前準備: 会議とGrasp設定を作成');
    await createMeeting(page);

    const configName = '×ボタンテスト';
    const configYaml = createSampleYaml(1);
    const configId = await saveGraspConfig(page, configName, configYaml);

    console.log('Step 1: Grasp設定タブを開いて設定を選択');
    await openGraspConfigTab(page);
    const configVersionButton = page.locator(`[data-testid="config-version-${configId}"]`);
    await configVersionButton.click();

    console.log('Step 2: 編集ボタンをクリックしてモーダルを開く');
    const editButton = page.locator('[data-testid="edit-button"]');
    await editButton.click();

    console.log('Step 3: YAMLを変更');
    const modalYamlTextarea = page.locator('[data-testid="modal-yaml-textarea"]');
    await expect(modalYamlTextarea).toBeVisible();
    await modalYamlTextarea.fill(createSampleYaml(55));

    console.log('Step 4: ×ボタンをクリック');

    // 確認ダイアログのハンドリング
    page.once('dialog', async dialog => {
      console.log('  ✓ 確認ダイアログが表示された');
      await dialog.accept();
    });

    const modalCloseButton = page.locator('[data-testid="modal-close-button"]');
    await modalCloseButton.click();

    console.log('Step 5: モーダルが閉じる');
    const modalBackdrop = page.locator('[data-testid="modal-backdrop"]');
    await expect(modalBackdrop).not.toBeVisible({ timeout: 5000 });

    console.log('  ✓ ×ボタンで編集が破棄された');
    console.log('✅ テスト完了！');
  });

  test('保存エラー時はモーダルが閉じずに編集を続けられる', async ({ page }) => {
    console.log('事前準備: 会議とGrasp設定を作成');
    const meetingId = await createMeeting(page);

    const configName = 'エラーテスト設定';
    const configYaml = createSampleYaml(1);
    const configId = await saveGraspConfig(page, configName, configYaml);
    await applyConfigToMeeting(page, meetingId, configId);

    console.log('Step 1: Grasp設定タブを開いて設定を選択');
    await openGraspConfigTab(page);
    const configVersionButton = page.locator(`[data-testid="config-version-${configId}"]`);
    await configVersionButton.click();

    console.log('Step 2: 編集ボタンをクリックしてモーダルを開く');
    const editButton = page.locator('[data-testid="edit-button"]');
    await editButton.click();

    console.log('Step 3: YAMLを変更');
    const modalYamlTextarea = page.locator('[data-testid="modal-yaml-textarea"]');
    await expect(modalYamlTextarea).toBeVisible();
    const newYaml = createSampleYaml(100);
    await modalYamlTextarea.fill(newYaml);

    console.log('Step 4: API エラーをシミュレートするためにネットワークをブロック');
    await page.route('**/meetings/*/grasp-config', route => route.abort());

    console.log('Step 5: 保存して適用ボタンをクリック');
    
    // アラートダイアログのハンドリング
    let alertShown = false;
    page.once('dialog', async dialog => {
      console.log('  ✓ エラーアラートが表示された:', dialog.message());
      expect(dialog.type()).toBe('alert');
      alertShown = true;
      await dialog.accept();
    });

    const modalSaveButton = page.locator('[data-testid="modal-save-and-apply-button"]');
    await modalSaveButton.click();

    // アラートが表示されるまで少し待つ
    await page.waitForTimeout(2000);
    expect(alertShown).toBe(true);

    console.log('Step 6: モーダルがまだ開いていることを確認');
    const modalBackdrop = page.locator('[data-testid="modal-backdrop"]');
    await expect(modalBackdrop).toBeVisible();

    console.log('Step 7: YAMLが編集状態のまま残っていることを確認');
    const currentYaml = await modalYamlTextarea.inputValue();
    expect(currentYaml).toContain('test-grasp-v100');

    console.log('  ✓ エラー時もモーダルが開いたままで編集を続けられる');
    console.log('✅ テスト完了！');
  });
});
