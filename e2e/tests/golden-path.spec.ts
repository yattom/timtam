import { test, expect, Page, BrowserContext, chromium } from '@playwright/test';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ESM環境で__dirnameを取得
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * E2Eテスト: 会議のゴールデンパス
 *
 * このテストは以下の操作をシミュレートします：
 * 1. ページを開く
 * 2. 自分の名前を設定する
 * 3. GraspYAMLを設定する
 * 4. 会議を開始する
 * 5. 別ブラウザ、別セッションで同じ会議に参加する
 * 6. 両方のブラウザから音声を入力する（実際の音声ファイルをループ再生）
 * 7. 文字起こしがされることを確認する（内容の長さは問わない）
 * 8. AIアシスタントが反応することを確認する
 * 9. 会議を終了する
 */

// デフォルトのGrasp YAML設定
const DEFAULT_GRASP_YAML = `grasps:
  - nodeId: "basic-facilitator"
    promptTemplate: |
      以下は会議の直近確定発話です。
      会話の内容を確認し、必要に応じてサポートしてください。
      
      介入が必要かを判断してください。
      ---
      {{INPUT:latest5}}
    intervalSec: 20
    outputHandler: "chat"
`;

// テスト設定定数
const AUDIO_INPUT_DURATION_MS = 30000; // 音声入力のシミュレーション時間（30秒）

/**
 * ページで名前を設定する
 */
async function setDisplayName(page: Page, name: string) {
  await page.fill('[data-testid="display-name-input"]', name);
  await page.click('[data-testid="save-name-button"]');
  // 保存メッセージが表示されるのを待つ
  await expect(page.locator('[data-testid="name-message"]')).toBeVisible({ timeout: 5000 });
}

/**
 * Grasp YAMLを設定する
 */
async function setGraspConfig(page: Page, yaml: string) {
  // Grasp設定パネルを探す
  const graspSection = page.locator('[data-testid="grasp-config-section"]');
  await expect(graspSection).toBeVisible();

  // パネルが折りたたまれている場合は開く
  const isOpen = await graspSection.getAttribute('open');
  if (isOpen === null) {
    // details要素のsummaryをクリックして開く
    await graspSection.locator('summary').click();
    await page.waitForTimeout(300); // アニメーションを待つ
  }

  // YAMLテキストエリアを見つけて入力
  const textarea = page.locator('[data-testid="grasp-yaml-textarea"]');
  await textarea.fill(yaml);

  // 保存ボタンをクリック
  const saveButton = page.locator('[data-testid="grasp-save-button"]');
  await saveButton.click();

  // 保存成功メッセージを待つ
  await expect(page.locator('text=設定を適用しました')).toBeVisible({ timeout: 5000 });
}

/**
 * 会議を作成して参加する
 */
async function createAndJoinMeeting(page: Page): Promise<string> {
  // マイク許可をリクエスト（必要な場合）
  const micRequestButton = page.locator('[data-testid="request-mic-permission-button"]');
  if (await micRequestButton.isVisible()) {
    await micRequestButton.click();
    await page.waitForTimeout(1000);
  }

  // 新規作成して入室ボタンをクリック
  await page.click('[data-testid="create-and-join-button"]');

  // 会議IDが表示されるまで待つ
  await page.waitForSelector('text=/meetingId: [a-f0-9-]{36}/', { timeout: 30000 });

  // 会議IDを取得
  const meetingIdText = await page.locator('text=/meetingId: [a-f0-9-]{36}/').textContent();
  const meetingId = meetingIdText?.match(/[a-f0-9-]{36}/)?.[0];

  if (!meetingId) {
    throw new Error('会議IDが取得できませんでした');
  }

  // 退室ボタンが表示されることを確認（参加完了の証拠）
  await expect(page.locator('[data-testid="leave-button"]')).toBeVisible({ timeout: 10000 });

  return meetingId;
}

/**
 * 既存の会議に参加する
 */
async function joinExistingMeeting(page: Page, meetingId: string) {
  // マイク許可をリクエスト（必要な場合）
  const micRequestButton = page.locator('[data-testid="request-mic-permission-button"]');
  if (await micRequestButton.isVisible()) {
    await micRequestButton.click();
    await page.waitForTimeout(1000);
  }

  // 会議IDを入力
  await page.fill('[data-testid="join-meeting-id-input"]', meetingId);

  // 入室ボタンをクリック
  await page.click('[data-testid="join-existing-button"]');

  // 退室ボタンが表示されることを確認（参加完了の証拠）
  await expect(page.locator('[data-testid="leave-button"]')).toBeVisible({ timeout: 10000 });
}

/**
 * 文字起こしが表示されることを確認する
 */
async function waitForTranscription(page: Page, timeoutMs: number = 60000) {
  // 文字起こしセクションを探す
  const transcriptionSection = page.locator('[data-testid="transcription-section"]');
  await expect(transcriptionSection).toBeVisible();

  // 文字起こしエリアまでスクロール
  const transcriptionContainer = page.locator('[data-testid="transcription-output"]');
  await transcriptionContainer.scrollIntoViewIfNeeded();

  // スクロール後、少し待ってからスクリーンショットを撮る
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `screenshot-transcription-${Date.now()}.png`, fullPage: true });

  // 現在の文字起こしエリアの内容をログ出力
  const currentText = await transcriptionContainer.textContent();
  console.log(`[Transcription Check] Current text length: ${currentText?.length || 0}`);
  console.log(`[Transcription Check] Current text: ${currentText?.substring(0, 200)}...`);

  // 文字起こしのテキストが表示されるまで待つ（長さは問わない）
  await page.waitForFunction(
    () => {
      const container = document.querySelector('[data-testid="transcription-output"]');
      const text = container?.textContent || '';
      // デバッグ用に定期的にログ出力
      if (typeof window !== 'undefined' && !(window as any).__transcriptionCheckLogged) {
        console.log(`[Transcription Wait] text.length=${text.length}`);
        (window as any).__transcriptionCheckLogged = true;
        setTimeout(() => { (window as any).__transcriptionCheckLogged = false; }, 5000);
      }
      // 初期メッセージではなく、実際の文字起こしが含まれているか確認（長さは不問）
      return text.length > 0 && !text.includes('ここに文字起こしが表示される');
    },
    { timeout: timeoutMs }
  );
}

/**
 * AIアシスタントの反応を確認する
 */
async function waitForAiResponse(page: Page, timeoutMs: number = 90000) {
  // AIアシスタントセクションを探す
  const aiSection = page.locator('[data-testid="ai-assistant-section"]');
  await expect(aiSection).toBeVisible();

  // AIメッセージが表示されるのを待つ（長さは問わない）
  await page.waitForFunction(
    () => {
      const container = document.querySelector('[data-testid="ai-assistant-output"]');
      const text = container?.textContent || '';
      // AIメッセージが含まれているか確認（初期メッセージではない、長さは不問）
      return text.length > 0 && !text.includes('AIアシスタントからのメッセージがここに表示される');
    },
    { timeout: timeoutMs }
  );
}

/**
 * 会議を終了する
 */
async function endMeeting(page: Page) {
  await page.click('[data-testid="end-meeting-button"]');

  // 会議終了メッセージが表示されることを確認
  await expect(page.locator('text=この会議は終了済みとして記録されています')).toBeVisible({ timeout: 10000 });
}

test.describe('E2E: 会議のゴールデンパス', () => {
  test.setTimeout(180000); // 3分のタイムアウト

  test('会議の作成、参加、文字起こし、AI反応、終了までの一連の流れ', async ({}) => {
    // 音声ファイルのパスを構築 (WAV: 48kHz, mono, 16-bit PCM)
    const audioFile1 = path.join(__dirname, 'data', '7089352122583608.wav');
    const audioFile2 = path.join(__dirname, 'data', '7089352122583706.wav');

    // BASE_URLを環境変数から取得（デフォルトはlocalhost）
    const baseURL = process.env.BASE_URL || 'http://localhost:5173';

    // 2つの別々のブラウザインスタンスを起動（それぞれ異なる音声ファイルを使用）
    // 音声はループして再生され、文字起こしが到着するまで継続的に音声を送る
    const browser1 = await chromium.launch({
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-audio-capture=${audioFile1}`,
      ],
    });

    const browser2 = await chromium.launch({
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-audio-capture=${audioFile2}`,
      ],
    });

    // 各ブラウザからコンテキストとページを作成
    const context1 = await browser1.newContext({
      permissions: ['microphone'],
      baseURL,
    });
    const context2 = await browser2.newContext({
      permissions: ['microphone'],
      baseURL,
    });

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    // ネットワークトラフィックとコンソールログをキャプチャ
    const networkLogs: string[] = [];
    const consoleLogs: string[] = [];

    // Page1のネットワークとコンソールをログ
    page1.on('request', request => {
      networkLogs.push(`[Page1 Request] ${request.method()} ${request.url()}`);
    });
    page1.on('response', response => {
      networkLogs.push(`[Page1 Response] ${response.status()} ${response.url()}`);
    });
    page1.on('console', msg => {
      consoleLogs.push(`[Page1 Console ${msg.type()}] ${msg.text()}`);
    });
    page1.on('websocket', ws => {
      console.log(`[Page1 WebSocket] ${ws.url()}`);
      ws.on('framesent', frame => console.log(`[Page1 WS Send] ${frame.payload}`));
      ws.on('framereceived', frame => console.log(`[Page1 WS Recv] ${frame.payload}`));
    });

    // Page2のネットワークとコンソールをログ
    page2.on('request', request => {
      networkLogs.push(`[Page2 Request] ${request.method()} ${request.url()}`);
    });
    page2.on('response', response => {
      networkLogs.push(`[Page2 Response] ${response.status()} ${response.url()}`);
    });
    page2.on('console', msg => {
      consoleLogs.push(`[Page2 Console ${msg.type()}] ${msg.text()}`);
    });
    page2.on('websocket', ws => {
      console.log(`[Page2 WebSocket] ${ws.url()}`);
      ws.on('framesent', frame => console.log(`[Page2 WS Send] ${frame.payload}`));
      ws.on('framereceived', frame => console.log(`[Page2 WS Recv] ${frame.payload}`));
    });

    try {
      // ===== ユーザー1: 会議を作成 =====
      console.log('Step 1: ページを開く (ユーザー1)');
      await page1.goto('/');
      await page1.waitForLoadState('networkidle');

      console.log('Step 2: 名前を設定する (ユーザー1)');
      await setDisplayName(page1, 'たろう');

      console.log('Step 3: Grasp YAMLを設定する (ユーザー1)');
      await setGraspConfig(page1, DEFAULT_GRASP_YAML);

      console.log('Step 4: 会議を開始する (ユーザー1)');
      const meetingId = await createAndJoinMeeting(page1);
      console.log(`会議ID: ${meetingId}`);

      // ===== ユーザー2: 会議に参加 =====
      console.log('Step 5: 別ブラウザで会議に参加 (ユーザー2)');
      await page2.goto('/');
      await page2.waitForLoadState('networkidle');
      await setDisplayName(page2, 'はなこ');
      await joinExistingMeeting(page2, meetingId);

      // 両方のページで参加していることを確認
      await expect(page1.locator('[data-testid="leave-button"]')).toBeVisible();
      await expect(page2.locator('[data-testid="leave-button"]')).toBeVisible();

      console.log('Step 6: 音声入力のシミュレーション（実際の音声ファイル使用）');
      // 実際の音声ファイルを使ってブラウザが音声入力をシミュレートする
      // 音声はループ再生され、継続的に音声データがChimeサーバーに送られる
      // システムが文字起こしを処理する時間を与えるために30秒待機
      await page1.waitForTimeout(AUDIO_INPUT_DURATION_MS);

      console.log('Step 7: 文字起こしの確認');
      // 文字起こしが両方のページで表示されることを確認
      await Promise.all([
        waitForTranscription(page1, 60000),
        waitForTranscription(page2, 60000),
      ]);

      console.log('Step 8: AIアシスタントの反応確認');
      // AIアシスタントが反応することを確認
      // Grasp設定のintervalSecが20秒なので、少なくとも1回は実行されるはず
      await Promise.all([
        waitForAiResponse(page1, 90000),
        waitForAiResponse(page2, 90000),
      ]);

      console.log('Step 9: 会議を終了する');
      await endMeeting(page1);

      // ユーザー2のページでも会議終了が反映されることを確認
      await page2.reload();
      await expect(page2.locator('text=この会議は終了済みとして記録されています')).toBeVisible({ timeout: 10000 });

      console.log('✅ E2Eテスト完了！');
    } catch (error) {
      console.error('テストエラー:', error);
      throw error;
    } finally {
      // ログをファイルに保存
      const fs = await import('fs');
      const timestamp = Date.now();

      console.log(`\n=== Network Logs (${networkLogs.length} entries) ===`);
      networkLogs.slice(-20).forEach(log => console.log(log)); // 最後の20件を表示

      console.log(`\n=== Console Logs (${consoleLogs.length} entries) ===`);
      consoleLogs.slice(-20).forEach(log => console.log(log)); // 最後の20件を表示

      await fs.promises.writeFile(
        `network-logs-${timestamp}.txt`,
        networkLogs.join('\n'),
        'utf-8'
      );
      await fs.promises.writeFile(
        `console-logs-${timestamp}.txt`,
        consoleLogs.join('\n'),
        'utf-8'
      );

      console.log(`\nログファイルを保存: network-logs-${timestamp}.txt, console-logs-${timestamp}.txt`);

      // クリーンアップ
      await page1.close();
      await page2.close();
      await context1.close();
      await context2.close();
      await browser1.close();
      await browser2.close();
    }
  });
});
