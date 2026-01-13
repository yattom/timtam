import { test, expect } from '@playwright/test';

test.describe('timtam web UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should display the main UI elements', async ({ page }) => {
    // ページタイトルを確認
    await expect(page.locator('h1')).toContainText('timtam web');
    
    // 主要なセクションが表示されていることを確認
    await expect(page.getByTestId('display-name-input')).toBeVisible();
    await expect(page.getByTestId('save-name-button')).toBeVisible();
    await expect(page.getByTestId('transcription-section')).toBeVisible();
    await expect(page.getByTestId('ai-assistant-section')).toBeVisible();
    await expect(page.getByTestId('grasp-config-section')).toBeVisible();
  });

  test('should allow entering and saving a display name', async ({ page }) => {
    const displayNameInput = page.getByTestId('display-name-input');
    const saveButton = page.getByTestId('save-name-button');
    
    // 名前を入力
    await displayNameInput.clear();
    await displayNameInput.fill('テストユーザー');
    
    // 保存ボタンをクリック
    await saveButton.click();
    
    // メッセージが表示されることを確認
    await expect(page.getByTestId('name-message')).toBeVisible();
    await expect(page.getByTestId('name-message')).toContainText('保存した');
    
    // リロード後も名前が保持されていることを確認
    await page.reload();
    await expect(displayNameInput).toHaveValue('テストユーザー');
  });

  test('should display meeting controls when not joined', async ({ page }) => {
    // 入室前は新規作成ボタンと既存入室ボタンが表示される
    await expect(page.getByTestId('create-and-join-button')).toBeVisible();
    await expect(page.getByTestId('join-meeting-id-input')).toBeVisible();
    await expect(page.getByTestId('join-existing-button')).toBeVisible();
    
    // 入室後のボタンは表示されない
    await expect(page.getByTestId('leave-button')).not.toBeVisible();
    await expect(page.getByTestId('toggle-mute-button')).not.toBeVisible();
    await expect(page.getByTestId('end-meeting-button')).not.toBeVisible();
  });

  test('should allow entering a meeting ID', async ({ page }) => {
    const meetingIdInput = page.getByTestId('join-meeting-id-input');
    
    // ミーティングIDを入力
    const testMeetingId = 'test-meeting-123';
    await meetingIdInput.fill(testMeetingId);
    
    // 入力値が正しく反映されることを確認
    await expect(meetingIdInput).toHaveValue(testMeetingId);
  });

  test('should display transcription panel', async ({ page }) => {
    const transcriptionSection = page.getByTestId('transcription-section');
    const transcriptionOutput = page.getByTestId('transcription-output');
    
    // 文字起こしセクションが表示されている
    await expect(transcriptionSection).toBeVisible();
    await expect(transcriptionOutput).toBeVisible();
    
    // 初期状態ではプレースホルダーメッセージが表示される
    await expect(transcriptionOutput).toContainText('ここに文字起こしが表示される');
  });

  test('should display AI assistant panel', async ({ page }) => {
    const aiAssistantSection = page.getByTestId('ai-assistant-section');
    const aiAssistantOutput = page.getByTestId('ai-assistant-output');
    
    // AIアシスタントセクションが表示されている
    await expect(aiAssistantSection).toBeVisible();
    await expect(aiAssistantOutput).toBeVisible();
  });

  test('should display Grasp config panel', async ({ page }) => {
    const graspConfigSection = page.getByTestId('grasp-config-section');
    const graspConfigPanel = page.getByTestId('grasp-config-panel');
    
    // Grasp設定セクションが表示されている
    await expect(graspConfigSection).toBeVisible();
    
    // details要素を開く
    await graspConfigSection.click();
    
    // パネルの内容が表示される
    await expect(graspConfigPanel).toBeVisible();
  });

  test('should allow editing Grasp YAML config', async ({ page }) => {
    const graspConfigSection = page.getByTestId('grasp-config-section');
    
    // details要素を開く
    await graspConfigSection.click();
    
    const yamlTextarea = page.getByTestId('grasp-yaml-textarea');
    const saveButton = page.getByTestId('grasp-save-button');
    
    // テキストエリアとボタンが表示される
    await expect(yamlTextarea).toBeVisible();
    await expect(saveButton).toBeVisible();
    
    // テキストエリアに入力できることを確認
    await yamlTextarea.fill('# Test YAML\ntest: value');
    await expect(yamlTextarea).toHaveValue('# Test YAML\ntest: value');
  });

  test('should handle mic permission request button', async ({ page }) => {
    // マイク許可ボタンは条件によって表示される
    // ボタンが存在する場合はクリック可能であることを確認
    const micButton = page.getByTestId('request-mic-permission-button');
    const buttonCount = await micButton.count();
    
    if (buttonCount > 0) {
      await expect(micButton).toBeVisible();
    }
  });
});
