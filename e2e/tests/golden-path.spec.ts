import { test, expect, Page, BrowserContext } from '@playwright/test';

/**
 * E2Eテスト: 会議のゴールデンパス
 * 
 * このテストは以下の操作をシミュレートします：
 * 1. ページを開く
 * 2. 自分の名前を設定する
 * 3. GraspYAMLを設定する
 * 4. 会議を開始する
 * 5. 別ブラウザ、別セッションで同じ会議に参加する
 * 6. 両方のブラウザから30秒ほど音声を入力する（フェイクメディアストリーム使用）
 * 7. 文字起こしがされることを確認する
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

/**
 * ページで名前を設定する
 */
async function setDisplayName(page: Page, name: string) {
  await page.fill('input[placeholder*="ひらがなで入力"]', name);
  await page.click('button:has-text("保存")');
  // 保存メッセージが表示されるのを待つ
  await expect(page.locator('text=名前を保存したよ')).toBeVisible({ timeout: 5000 });
}

/**
 * Grasp YAMLを設定する
 */
async function setGraspConfig(page: Page, yaml: string) {
  // Grasp設定パネルを探す
  const graspSection = page.locator('h3:has-text("Grasp設定")').locator('..');
  await expect(graspSection).toBeVisible();
  
  // YAMLテキストエリアを見つけて入力
  const textarea = graspSection.locator('textarea');
  await textarea.fill(yaml);
  
  // 保存ボタンをクリック
  const saveButton = graspSection.locator('button:has-text("保存")');
  await saveButton.click();
  
  // 保存成功メッセージを待つ
  await expect(page.locator('text=設定を保存しました')).toBeVisible({ timeout: 5000 });
}

/**
 * 会議を作成して参加する
 */
async function createAndJoinMeeting(page: Page): Promise<string> {
  // マイク許可をリクエスト（必要な場合）
  const micRequestButton = page.locator('button:has-text("マイク許可をリクエスト")');
  if (await micRequestButton.isVisible()) {
    await micRequestButton.click();
    await page.waitForTimeout(1000);
  }
  
  // 新規作成して入室ボタンをクリック
  await page.click('button:has-text("新規作成して入室")');
  
  // 会議IDが表示されるまで待つ
  await page.waitForSelector('text=/meetingId: [a-f0-9-]{36}/', { timeout: 30000 });
  
  // 会議IDを取得
  const meetingIdText = await page.locator('text=/meetingId: [a-f0-9-]{36}/').textContent();
  const meetingId = meetingIdText?.match(/[a-f0-9-]{36}/)?.[0];
  
  if (!meetingId) {
    throw new Error('会議IDが取得できませんでした');
  }
  
  // 退室ボタンが表示されることを確認（参加完了の証拠）
  await expect(page.locator('button:has-text("退室")')).toBeVisible({ timeout: 10000 });
  
  return meetingId;
}

/**
 * 既存の会議に参加する
 */
async function joinExistingMeeting(page: Page, meetingId: string) {
  // マイク許可をリクエスト（必要な場合）
  const micRequestButton = page.locator('button:has-text("マイク許可をリクエスト")');
  if (await micRequestButton.isVisible()) {
    await micRequestButton.click();
    await page.waitForTimeout(1000);
  }
  
  // 会議IDを入力
  await page.fill('input[placeholder="meetingId"]', meetingId);
  
  // 入室ボタンをクリック
  await page.click('button:has-text("このIDで入室")');
  
  // 退室ボタンが表示されることを確認（参加完了の証拠）
  await expect(page.locator('button:has-text("退室")')).toBeVisible({ timeout: 10000 });
}

/**
 * 文字起こしが表示されることを確認する
 */
async function waitForTranscription(page: Page, timeoutMs: number = 60000) {
  // 文字起こしセクションを探す
  const transcriptionSection = page.locator('h3:has-text("文字起こし")').locator('..');
  await expect(transcriptionSection).toBeVisible();
  
  // 文字起こしが表示されるのを待つ（初期メッセージ以外のテキスト）
  const transcriptionContainer = transcriptionSection.locator('div[style*="border"]');
  
  // 文字起こしのテキストが表示されるまで待つ
  await page.waitForFunction(
    (container) => {
      const text = container.textContent || '';
      // 初期メッセージではなく、実際の文字起こしが含まれているか確認
      return text.length > 50 && !text.includes('ここに文字起こしが表示される');
    },
    transcriptionContainer,
    { timeout: timeoutMs }
  );
}

/**
 * AIアシスタントの反応を確認する
 */
async function waitForAiResponse(page: Page, timeoutMs: number = 90000) {
  // AIアシスタントセクションを探す
  const aiSection = page.locator('h3:has-text("AI Assistant")').locator('..');
  await expect(aiSection).toBeVisible();
  
  // AIメッセージが表示されるのを待つ
  const aiOutputContainer = aiSection.locator('div[style*="border"]');
  
  await page.waitForFunction(
    (container) => {
      const text = container.textContent || '';
      // AIメッセージが含まれているか確認（初期メッセージではない）
      return text.length > 30 && !text.includes('AI Assistantのメッセージがここに表示される');
    },
    aiOutputContainer,
    { timeout: timeoutMs }
  );
}

/**
 * 会議を終了する
 */
async function endMeeting(page: Page) {
  await page.click('button:has-text("会議終了を記録")');
  
  // 会議終了メッセージが表示されることを確認
  await expect(page.locator('text=この会議は終了済みとして記録されています')).toBeVisible({ timeout: 10000 });
}

test.describe('E2E: 会議のゴールデンパス', () => {
  test.setTimeout(180000); // 3分のタイムアウト

  test('会議の作成、参加、文字起こし、AI反応、終了までの一連の流れ', async ({ browser }) => {
    // 2つのコンテキスト（別セッション）を作成
    const context1 = await browser.newContext({
      permissions: ['microphone'],
    });
    const context2 = await browser.newContext({
      permissions: ['microphone'],
    });

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

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
      await expect(page1.locator('button:has-text("退室")')).toBeVisible();
      await expect(page2.locator('button:has-text("退室")')).toBeVisible();

      console.log('Step 6: 音声入力のシミュレーション（フェイクメディアストリーム使用）');
      // Playwrightのフェイクメディアストリームは自動的に音声を生成する
      // 30秒待機して、システムが文字起こしを処理する時間を与える
      await page1.waitForTimeout(30000);

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
    } finally {
      // クリーンアップ
      await page1.close();
      await page2.close();
      await context1.close();
      await context2.close();
    }
  });
});
