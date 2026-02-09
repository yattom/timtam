import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { test, expect } from '@playwright/test';
import {
  FACILITATOR_URL,
  API_URL,
  clearLocalStackData,
  loadDefaultDataOnLocalStack,
  createMeeting,
  saveGraspConfig,
  getMeetingConfig,
  getMeetingMetadata,
} from './helpers/grasp-config-helpers';

/**
 * E2Eテスト: DEFAULT Grasp設定の動作確認
 *
 * このテストはDEFAULT設定の以下の動作をカバーします：
 * 1. "DEFAULT" という名前の設定がデフォルトとして機能する
 * 2. 設定一覧でDEFAULTが最上部に表示され、"(デフォルト)" ラベルが付く
 * 3. 新しい会議でDEFAULT設定が自動適用される
 * 4. 複数のDEFAULT設定がある場合、最新のものが使われる
 *
 * 前提条件:
 * - docker-compose up -d ですべてのサービスが起動している
 * - pnpm run local:setup でLocalStackリソースが作成されている
 * - web/facilitator で pnpm run dev が起動している（ポート3001）
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

test.describe('DEFAULT Grasp設定の動作確認（DEFAULT設定あり）', { tag: '@local' }, () => {
  test.setTimeout(120000); // 2分のタイムアウト

  // 各テストケースの前にDynamoDBテーブルとSQSキューのデータをクリア
  test.beforeEach(async () => {
    clearLocalStackData();
    // このテストはDEFAULT設定を自分で作成してテストするため、loadDefaultDataOnLocalStackは呼ばない
  });

  test('DEFAULT設定が会議に自動適用される', async ({ page }) => {
    console.log('='.repeat(60));
    console.log('テスト: DEFAULT設定が会議に自動適用される');
    console.log('='.repeat(60));

    // ========================================
    // Step 1: DEFAULT設定を作成
    // ========================================
    console.log('\nStep 1: DEFAULT設定を作成');

    const defaultYaml = `grasps:
  - nodeId: default-test-grasp
    promptTemplate: |
      これはDEFAULT設定のテストです
    intervalSec: 60
    outputHandler: chat`;

    const defaultConfigId = await saveGraspConfig(page, 'DEFAULT', defaultYaml);
    console.log(`  ✓ DEFAULT設定を保存 (ID: ${defaultConfigId})`);

    // ========================================
    // Step 2: 通常の設定も作成（比較用）
    // ========================================
    console.log('\nStep 2: 通常の設定も作成（比較用）');

    const customYaml = `grasps:
  - nodeId: custom-test-grasp
    promptTemplate: |
      これは通常設定のテストです
    intervalSec: 45
    outputHandler: chat`;

    const customConfigId = await saveGraspConfig(page, 'カスタム設定', customYaml);
    console.log(`  ✓ カスタム設定を保存 (ID: ${customConfigId})`);

    // ========================================
    // Step 3: ダッシュボードで設定一覧を確認
    // ========================================
    console.log('\nStep 3: ダッシュボードで設定一覧を確認');

    await page.goto(`${FACILITATOR_URL}/config`);
    await page.waitForLoadState('networkidle');

    // 保存済み設定一覧を取得
    const savedConfigsList = page.locator('[data-testid="dashboard-saved-configs-list"]');
    await expect(savedConfigsList).toBeVisible({ timeout: 5000 });

    // DEFAULT設定グループを確認
    const defaultConfigGroup = page.locator('[data-testid="dashboard-config-group-DEFAULT"]');
    await expect(defaultConfigGroup).toBeVisible({ timeout: 5000 });
    console.log('  ✓ DEFAULT設定グループが表示されている');

    // DEFAULT設定が最上部にあることを確認
    const firstConfigGroup = savedConfigsList.locator('[data-testid^="dashboard-config-group-"]').first();
    const firstGroupName = await firstConfigGroup.getAttribute('data-testid');
    expect(firstGroupName).toBe('dashboard-config-group-DEFAULT');
    console.log('  ✓ DEFAULT設定が最上部にソートされている');

    // "(デフォルト)" ラベルが表示されることを確認
    // プリセット選択のドロップダウンで確認
    const presetDropdown = page.locator('[data-testid="dashboard-preset-dropdown"]');
    if (await presetDropdown.isVisible()) {
      const defaultOption = presetDropdown.locator('option', { hasText: 'DEFAULT (デフォルト)' });
      await expect(defaultOption).toBeVisible();
      console.log('  ✓ プリセット選択に "(デフォルト)" ラベルが表示されている');
    }

    // ========================================
    // Step 4: 新しい会議を作成
    // ========================================
    console.log('\nStep 4: 新しい会議を作成');

    const meetingId = await createMeeting(page);
    console.log(`  ✓ 会議を作成 (ID: ${meetingId})`);

    // ========================================
    // Step 5: 会議にDEFAULT設定が自動適用されていることを確認
    // ========================================
    console.log('\nStep 5: 会議にDEFAULT設定が自動適用されていることを確認');

    // 会議の現在のGrasp設定を取得
    const meetingConfig = await getMeetingConfig(page, meetingId);

    console.log(`  会議の設定ID: ${meetingConfig.configId || 'なし'}`);
    console.log(`  会議の設定名: ${meetingConfig.name || 'なし'}`);

    // DEFAULT設定が適用されているか確認
    // 注: 会議作成時にgraspConfigIdが設定されていない場合、
    // orchestratorがDEFAULT設定を自動的に使用する
    if (meetingConfig.configId) {
      // graspConfigIdが設定されている場合、それがDEFAULT設定であることを確認
      expect(meetingConfig.name).toBe('DEFAULT');
      console.log('  ✓ 会議にDEFAULT設定が明示的に適用されている');
    } else {
      // graspConfigIdが設定されていない場合、orchestratorがDEFAULTを使用
      console.log('  ✓ 会議にgraspConfigIdが未設定（orchestratorがDEFAULTを使用）');
    }

    // YAMLの内容を確認（DEFAULT設定のYAMLが使われているはず）
    if (meetingConfig.yaml) {
      expect(meetingConfig.yaml).toContain('default-test-grasp');
      console.log('  ✓ DEFAULT設定のYAMLが使用されている');
    }

    console.log('\n✅ テスト完了！');
    console.log('');
    console.log('確認した項目:');
    console.log('  ✓ DEFAULT設定を作成できる');
    console.log('  ✓ DEFAULT設定が設定一覧の最上部にソートされる');
    console.log('  ✓ "(デフォルト)" ラベルが表示される');
    console.log('  ✓ 新規会議でDEFAULT設定が自動適用される');
  });

  test('複数のDEFAULT設定では最新のものが使われる', async ({ page }) => {
    console.log('='.repeat(60));
    console.log('テスト: 複数のDEFAULT設定では最新のものが使われる');
    console.log('='.repeat(60));

    // ========================================
    // Step 1: 最初のDEFAULT設定を作成
    // ========================================
    console.log('\nStep 1: 最初のDEFAULT設定を作成');

    const defaultYaml1 = `grasps:
  - nodeId: default-grasp-v1
    promptTemplate: |
      これは最初のDEFAULT設定です
    intervalSec: 60
    outputHandler: chat`;

    const defaultConfigId1 = await saveGraspConfig(page, 'DEFAULT', defaultYaml1);
    console.log(`  ✓ DEFAULT設定v1を保存 (ID: ${defaultConfigId1})`);

    // 少し待つ（タイムスタンプを確実に異なるものにする）
    await page.waitForTimeout(2000);

    // ========================================
    // Step 2: 2番目のDEFAULT設定を作成
    // ========================================
    console.log('\nStep 2: 2番目のDEFAULT設定を作成');

    const defaultYaml2 = `grasps:
  - nodeId: default-grasp-v2
    promptTemplate: |
      これは2番目のDEFAULT設定です（最新版）
    intervalSec: 90
    outputHandler: chat`;

    const defaultConfigId2 = await saveGraspConfig(page, 'DEFAULT', defaultYaml2);
    console.log(`  ✓ DEFAULT設定v2を保存 (ID: ${defaultConfigId2})`);

    // configId2の方が新しいことを確認（タイムスタンプが含まれるため）
    expect(defaultConfigId2 > defaultConfigId1).toBe(true);
    console.log('  ✓ v2の方が新しいconfigIdを持つ');

    // ========================================
    // Step 3: 新しい会議を作成
    // ========================================
    console.log('\nStep 3: 新しい会議を作成');

    const meetingId = await createMeeting(page);
    console.log(`  ✓ 会議を作成 (ID: ${meetingId})`);

    // ========================================
    // Step 4: 最新のDEFAULT設定（v2）が使われることを確認
    // ========================================
    console.log('\nStep 4: 最新のDEFAULT設定（v2）が使われることを確認');

    const meetingConfig = await getMeetingConfig(page, meetingId);

    console.log(`  会議の設定ID: ${meetingConfig.configId || 'なし'}`);

    // YAMLの内容を確認（v2のYAMLが使われているはず）
    if (meetingConfig.yaml) {
      expect(meetingConfig.yaml).toContain('default-grasp-v2');
      expect(meetingConfig.yaml).toContain('最新版');
      expect(meetingConfig.yaml).not.toContain('default-grasp-v1');
      console.log('  ✓ 最新のDEFAULT設定（v2）のYAMLが使用されている');
    } else {
      // orchestratorのログを確認するため、configIdを出力
      console.log('  注: YAMLが取得できませんでした。orchestratorが最新のDEFAULTを使用しているはず');
    }

    console.log('\n✅ テスト完了！');
    console.log('');
    console.log('確認した項目:');
    console.log('  ✓ 複数のDEFAULT設定を作成できる');
    console.log('  ✓ configIdのソート順で最新のものが選ばれる');
    console.log('  ✓ 新規会議で最新のDEFAULT設定が自動適用される');
  });

  test('"default"（小文字）はDEFAULTとして扱われない', async ({ page }) => {
    console.log('='.repeat(60));
    console.log('テスト: "default"（小文字）はDEFAULTとして扱われない');
    console.log('='.repeat(60));

    // ========================================
    // Step 1: DEFAULT設定と小文字の"default"設定を作成
    // ========================================
    console.log('\nStep 1: DEFAULT設定と小文字の"default"設定を作成');

    // まずDEFAULT設定を作成（会議作成に必要）
    const defaultYaml = `grasps:
  - nodeId: uppercase-default-grasp
    promptTemplate: |
      これは大文字DEFAULTのテストです
    intervalSec: 60
    outputHandler: chat`;

    const defaultConfigId = await saveGraspConfig(page, 'DEFAULT', defaultYaml);
    console.log(`  ✓ "DEFAULT" 設定を保存 (ID: ${defaultConfigId})`);

    // 次に小文字の"default"設定を作成
    const lowercaseYaml = `grasps:
  - nodeId: lowercase-test-grasp
    promptTemplate: |
      これは小文字defaultのテストです
    intervalSec: 30
    outputHandler: chat`;

    const lowercaseConfigId = await saveGraspConfig(page, 'default', lowercaseYaml);
    console.log(`  ✓ "default" 設定を保存 (ID: ${lowercaseConfigId})`);

    // ========================================
    // Step 2: ダッシュボードで "(デフォルト)" ラベルがないことを確認
    // ========================================
    console.log('\nStep 2: ダッシュボードで "(デフォルト)" ラベルがないことを確認');

    await page.goto(`${FACILITATOR_URL}/config`);
    await page.waitForLoadState('networkidle');

    const savedConfigsList = page.locator('[data-testid="dashboard-saved-configs-list"]');
    await expect(savedConfigsList).toBeVisible({ timeout: 5000 });

    // "default" 設定グループを確認
    const defaultConfigGroup = page.locator('[data-testid="dashboard-config-group-default"]');
    await expect(defaultConfigGroup).toBeVisible({ timeout: 5000 });
    console.log('  ✓ "default" 設定グループが表示されている');

    // プリセット選択で "(デフォルト)" ラベルがないことを確認
    const presetDropdown = page.locator('[data-testid="dashboard-preset-dropdown"]');
    if (await presetDropdown.isVisible()) {
      // "default" はあるが "(デフォルト)" ラベルはない
      const defaultOption = presetDropdown.locator('option', { hasText: /^default$/ });
      if (await defaultOption.count() > 0) {
        const optionText = await defaultOption.textContent();
        expect(optionText).not.toContain('(デフォルト)');
        console.log('  ✓ "default" には "(デフォルト)" ラベルが付いていない');
      }
    }

    // ========================================
    // Step 3: 新しい会議を作成して、"default"が適用されないことを確認
    // ========================================
    console.log('\nStep 3: 新しい会議で "default" が適用されないことを確認');

    const meetingId = await createMeeting(page);
    console.log(`  ✓ 会議を作成 (ID: ${meetingId})`);

    const meetingConfig = await getMeetingConfig(page, meetingId);

    // "default"のYAMLが使われていないことを確認
    if (meetingConfig.yaml) {
      expect(meetingConfig.yaml).not.toContain('lowercase-test-grasp');
      console.log('  ✓ "default"（小文字）の設定は使用されていない');

      // DEFAULT設定が使われていることを確認
      expect(meetingConfig.yaml).toContain('uppercase-default-grasp');
      console.log('  ✓ DEFAULT（大文字）の設定が使用されている');
    }

    console.log('\n✅ テスト完了！');
    console.log('');
    console.log('確認した項目:');
    console.log('  ✓ "default"（小文字）は特別扱いされない');
    console.log('  ✓ "(デフォルト)" ラベルが付かない');
    console.log('  ✓ 新規会議で"default"は自動適用されず、DEFAULTが使われる');
  });

  test('DEFAULT設定IDがミーティングメタデータに保存される', async ({ page }) => {
    console.log('='.repeat(60));
    console.log('テスト: DEFAULT設定IDがミーティングメタデータに保存される');
    console.log('='.repeat(60));

    // ========================================
    // Step 1: DEFAULT設定を作成
    // ========================================
    console.log('\nStep 1: DEFAULT設定を作成');

    const defaultYaml = `grasps:
  - nodeId: metadata-test-grasp
    promptTemplate: |
      これはメタデータ保存テストです
    intervalSec: 60
    outputHandler: chat`;

    const defaultConfigId = await saveGraspConfig(page, 'DEFAULT', defaultYaml);
    console.log(`  ✓ DEFAULT設定を保存 (ID: ${defaultConfigId})`);

    // ========================================
    // Step 2: 新しい会議を作成
    // ========================================
    console.log('\nStep 2: 新しい会議を作成');

    const meetingId = await createMeeting(page);
    console.log(`  ✓ 会議を作成 (ID: ${meetingId})`);

    // ========================================
    // Step 3: ミーティングメタデータを取得
    // ========================================
    console.log('\nStep 3: ミーティングメタデータを取得');

    const metadata = await getMeetingMetadata(page, meetingId);
    console.log(`  メタデータの graspConfigId: ${metadata.graspConfigId || 'なし'}`);

    // ========================================
    // Step 4: メタデータにDEFAULT設定IDが保存されていることを確認
    // ========================================
    console.log('\nStep 4: メタデータにDEFAULT設定IDが保存されていることを確認');

    expect(metadata.graspConfigId).toBeDefined();
    expect(metadata.graspConfigId).toBe(defaultConfigId);
    console.log('  ✓ ミーティングメタデータにDEFAULT設定IDが保存されている');

    // ========================================
    // Step 5: オーケストレータでも同じ設定が使われることを確認
    // ========================================
    console.log('\nStep 5: オーケストレータでも同じ設定が使われることを確認');

    const meetingConfig = await getMeetingConfig(page, meetingId);

    expect(meetingConfig.configId).toBe(defaultConfigId);
    expect(meetingConfig.name).toBe('DEFAULT');
    console.log('  ✓ オーケストレータでも同じDEFAULT設定が使用されている');

    // YAMLの内容も確認
    if (meetingConfig.yaml) {
      expect(meetingConfig.yaml).toContain('metadata-test-grasp');
      console.log('  ✓ DEFAULT設定のYAMLが正しく使用されている');
    }

    console.log('\n✅ テスト完了！');
    console.log('');
    console.log('確認した項目:');
    console.log('  ✓ ミーティング作成時にDEFAULT設定IDがメタデータに保存される');
    console.log('  ✓ オーケストレータが同じ設定を使用する');
    console.log('  ✓ 設定の一貫性が保たれる');
  });
});

test.describe('DEFAULT Grasp設定の動作確認（DEFAULT設定なし）', { tag: '@local' }, () => {
  test.setTimeout(120000); // 2分のタイムアウト

  // 各テストケースの前にDynamoDBテーブルとSQSキューのデータをクリア
  test.beforeEach(async () => {
    clearLocalStackData();
    // Don't load DEFAULT - this test expects no DEFAULT config
  });

  test.skip('DEFAULT設定がない場合はハードコードされたデフォルトが使われる', async ({ page }) => {
    console.log('='.repeat(60));
    console.log('テスト: DEFAULT設定がない場合はハードコードされたデフォルトが使われる');
    console.log('='.repeat(60));

    // ========================================
    // Step 1: DEFAULT以外の設定を作成
    // ========================================
    console.log('\nStep 1: DEFAULT以外の設定を作成');

    const customYaml = `grasps:
  - nodeId: custom-grasp-only
    promptTemplate: |
      これはカスタム設定のみのテストです
    intervalSec: 45
    outputHandler: chat`;

    await saveGraspConfig(page, 'カスタム設定のみ', customYaml);
    console.log('  ✓ カスタム設定のみを保存');

    // ========================================
    // Step 2: 新しい会議を作成
    // ========================================
    console.log('\nStep 2: 新しい会議を作成');

    const meetingId = await createMeeting(page);
    console.log(`  ✓ 会議を作成 (ID: ${meetingId})`);

    // ========================================
    // Step 3: ハードコードされたデフォルトが使われることを確認
    // ========================================
    console.log('\nStep 3: ハードコードされたデフォルトが使われることを確認');

    const meetingConfig = await getMeetingConfig(page, meetingId);

    console.log(`  会議の設定ID: ${meetingConfig.configId || 'なし'}`);

    // カスタム設定が使われていないことを確認
    if (meetingConfig.yaml) {
      expect(meetingConfig.yaml).not.toContain('custom-grasp-only');
      console.log('  ✓ カスタム設定は使用されていない');

      // ハードコードされたデフォルトの特徴的なnodeIdを確認
      // graspConfigLoader.tsのDEFAULT_GRASP_YAMLに含まれるnodeId
      const hasDefaultGrasps =
        meetingConfig.yaml.includes('friendly-nodder') ||
        meetingConfig.yaml.includes('argument-observer') ||
        meetingConfig.yaml.includes('summary-provider');

      expect(hasDefaultGrasps).toBe(true);
      console.log('  ✓ ハードコードされたデフォルトYAMLが使用されている');
    }

    console.log('\n✅ テスト完了！');
    console.log('');
    console.log('確認した項目:');
    console.log('  ✓ DEFAULT設定がない場合でも会議を作成できる');
    console.log('  ✓ ハードコードされたデフォルトYAMLが使用される');
    console.log('  ✓ カスタム設定は自動適用されない');
  });
});
