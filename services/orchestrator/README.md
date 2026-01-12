# Orchestrator Service - Multi-Meeting Support

## 概要

Orchestratorサービスは、Amazon Chimeミーティングのリアルタイム文字起こしを処理し、AIによる会議介入を行うサービスです。複数のミーティングを並行して処理できます。

## 主要機能

- **複数ミーティングの並行処理**: 最大100ミーティングを同時に処理可能
- **ミーティング間の完全な分離**: 各ミーティングは独立した状態を持ち、互いに干渉しません
- **自動リソース管理**: 非アクティブなミーティングを自動的にクリーンアップ
- **スケーラブルな設計**: 効率的なメモリとCPU使用

## アーキテクチャ

### コンポーネント

1. **MeetingOrchestrator**: 単一ミーティングの処理を担当
   - ミーティング固有の状態（WindowBuffer、Notebook、GraspQueue）を管理
   - ASRイベントを処理し、Graspを実行

2. **OrchestratorManager**: 複数のMeetingOrchestratorを管理
   - ミーティングIDに基づいて適切なオーケストレーターに振り分け
   - リソース管理とクリーンアップ

3. **Worker**: メインのイベントループ
   - SQSからASRイベントを取得
   - OrchestratorManagerに処理を委譲

詳細は [orchestrator-multi-meeting-architecture.md](../../docs/orchestrator-multi-meeting-architecture.md) を参照してください。

## 環境変数

### 必須

- `TRANSCRIPT_QUEUE_URL`: 文字起こしイベントを受信するSQS URL
- `BEDROCK_REGION`: AWS Bedrockのリージョン（デフォルト: us-east-1）
- `BEDROCK_MODEL_ID`: 使用するBedrockモデルID（デフォルト: anthropic.claude-haiku-4.5）
- `AI_MESSAGES_TABLE`: AI介入メッセージを保存するDynamoDBテーブル名
- `CONFIG_TABLE_NAME`: Grasp設定を保存するDynamoDBテーブル名

### オプション

- `MAX_MEETINGS`: 最大同時ミーティング数（デフォルト: 100）
- `MEETING_TIMEOUT_MS`: 非アクティブミーティングのタイムアウト（デフォルト: 3600000 = 1時間）
- `CONTROL_SQS_URL`: 制御メッセージを受信するSQS URL（Grasp設定更新用）

## セットアップ

### 依存関係のインストール

```bash
npm install
```

### ビルド

```bash
npm run build
```

### テスト

```bash
npm test
```

### 実行

```bash
npm run start:worker
```

## 使用方法

### 複数ミーティングの処理

Orchestratorは自動的に複数のミーティングを処理します。特別な設定は不要です。

各ASRイベントの`meetingId`に基づいて、適切なMeetingOrchestratorインスタンスが作成され、処理されます。

```json
{
  "meetingId": "meeting-12345",
  "text": "会議の発言内容",
  "isFinal": true,
  "timestamp": 1234567890000
}
```

### Grasp設定の更新

Grasp設定を動的に更新するには、`CONTROL_SQS_URL`に以下のメッセージを送信します:

```json
{
  "type": "grasp_config",
  "yaml": "grasps:\n  - nodeId: example\n    ..."
}
```

### ミーティングの状態確認

OrchestratorManagerの`getStatus()`メソッドを使用して、現在のミーティング状態を確認できます:

```typescript
const status = orchestratorManager.getStatus();
console.log(`Active meetings: ${status.totalMeetings}`);
status.meetings.forEach(m => {
  console.log(`${m.meetingId}: ${m.messageCount} messages`);
});
```

## テスト

テストスイートには88のテストケースが含まれています:

- `grasp.test.ts`: Graspの基本機能（32テスト）
- `graspConfigParser.test.ts`: 設定パーサー（39テスト）
- `multiMeeting.test.ts`: 複数ミーティング機能（17テスト）

すべてのテストを実行:

```bash
npm test
```

特定のテストファイルのみ実行:

```bash
npm test multiMeeting.test.ts
```

## パフォーマンス

### メモリ使用量

- 1ミーティングあたり: 約100KB〜1MB（発話数による）
- 100ミーティング: 約10MB〜100MB

### 同時処理能力

- テストでは20ミーティングの並行処理を確認
- 理論的には100ミーティングまで対応可能
- 実際の上限はAWS LambdaやECSのリソース制限に依存

## トラブルシューティング

### ミーティングが処理されない

1. `TRANSCRIPT_QUEUE_URL`が正しく設定されているか確認
2. SQSキューにメッセージが到達しているか確認
3. ログでエラーメッセージを確認

### メモリ不足

1. `MAX_MEETINGS`を減らす
2. `MEETING_TIMEOUT_MS`を短くして早くクリーンアップ
3. 非アクティブミーティングを手動で削除

### LLM呼び出しのエラー

1. `BEDROCK_REGION`と`BEDROCK_MODEL_ID`を確認
2. AWS認証情報が正しいか確認
3. Bedrockのクォータ制限を確認

## ログ

Orchestratorは構造化ログ（JSON形式）を出力します:

```json
{
  "type": "orchestrator.loop.poll",
  "loopCount": 100,
  "messageCount": 5,
  "activeMeetings": 3,
  "ts": 1234567890000
}
```

主要なログタイプ:

- `meeting.orchestrator.created`: 新しいミーティングが作成された
- `meeting.transcript.speaker`: 発言者情報を含む文字起こし
- `orchestrator.loop.poll`: メインループの状態
- `orchestrator.manager.cleanup`: クリーンアップが実行された

## 今後の拡張

- ミーティングごとの異なるGrasp設定
- ミーティング優先度管理
- 状態の永続化（DynamoDB）
- 分散処理（複数ワーカー）

## 関連ドキュメント

- [アーキテクチャ詳細](../../docs/orchestrator-multi-meeting-architecture.md)
- [Grasp設定ガイド](./grasp-config-guide.md)（TODO）
