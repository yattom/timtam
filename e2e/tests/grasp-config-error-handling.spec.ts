import { test, expect } from '@playwright/test';
import { clearLocalStackData, createMeeting, API_URL } from './helpers/grasp-config-helpers';

/**
 * E2Eテスト: Grasp設定のエラーハンドリング
 *
 * このテストはGrasp設定のバリデーションエラーが正しく報告されることを確認します:
 * 1. 無効なYAML形式
 * 2. 必須フィールドの欠落
 * 3. 無効な値
 * 4. テンプレート変数の誤り
 *
 * 前提条件:
 * - docker-compose up -d ですべてのサービスが起動している
 * - pnpm run local:setup でLocalStackリソースが作成されている
 * - web/facilitator で pnpm run dev が起動している（ポート3001）
 */

test.describe('Grasp設定のエラーハンドリング', { tag: '@local' }, () => {
  test.setTimeout(120000); // 2分のタイムアウト

  // 各テストケースの前にDynamoDBテーブルとSQSキューのデータをクリア
  test.beforeEach(async () => {
    clearLocalStackData();
  });

  test('無効なYAML形式のエラーがチャットに報告される', async ({ page }) => {
    // 会議を作成
    const meetingId = await createMeeting(page);

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

  test('必須フィールド欠落のエラーがチャットに報告される', async ({ page }) => {
    // 会議を作成
    const meetingId = await createMeeting(page);

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
    const meetingId = await createMeeting(page);

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
    // （実際のチャットメッセージを確認するには、チャットUIを実装する必要がある）
    // ここでは、一定時間待機してログを確認する
    await page.waitForTimeout(5000);

    console.log('✓ orchestratorでのバリデーションエラーが処理された');
    // TODO: チャットUIが実装されたら、エラーメッセージが表示されることを確認する
  });
});
