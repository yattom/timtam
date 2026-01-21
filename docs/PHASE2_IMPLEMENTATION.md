# Phase 2実装: Recall.ai統合

このドキュメントは、Issue #45のPhase 2実装の内容を説明する。

## 概要

Phase 2では、Recall.ai APIと統合して、サードパーティ会議サービス（Zoom、Google Meet、Microsoft Teams、Webex）に接続する機能を実装した。

## 実装内容

### M1: RecallAdapter完全実装

**ファイル:**
- `packages/shared/src/recall/RecallAPIClient.ts` - Recall.ai REST APIクライアント
- `packages/shared/src/adapters/RecallAdapter.ts` - RecallAdapter完全実装

**機能:**
1. `RecallAPIClient` - Recall.ai REST API完全実装
   - `createBot()` - ボット作成・会議参加
   - `getBot()` - ボット状態取得
   - `deleteBot()` - ボット削除・会議退出
   - `sendChatMessage()` - 会議チャットにメッセージ送信
   - `listBots()` - ボット一覧取得

2. `RecallAdapter` - MeetingServiceAdapter実装
   - `processInboundTranscript()` - Recall.ai Webhook形式 → TranscriptEvent（Phase 1から）
   - `postChat()` - Recall.ai Chat APIでメッセージ送信（Phase 2新規）
   - `postLlmCallLog()` - DynamoDBにLLMログ書き込み（Phase 2新規、Chimeと同じテーブル）

### M2: Webhook Lambda実装

**ファイル:**
- `services/meeting-api/recallWebhook.ts` - Recall.ai Webhookハンドラー

**機能:**
1. **リアルタイム文字起こし処理**
   - Recall.ai Webhookからtranscriptイベント受信
   - RecallAdapterで統一TranscriptEventに変換
   - SQS FIFOキューに送信（Chimeと同じキュー）
   - partial resultsはスキップ（final onlyを処理）

2. **参加者イベント処理**（Phase 2では未処理、ログのみ）
   - `participant.join`
   - `participant.leave`

3. **ボット状態イベント処理**（Phase 2では未処理、ログのみ）
   - `bot.status`

**TODO:**
- Webhook署名検証（`verifyWebhookSignature`関数をスタブ実装、セキュリティ警告あり）

### M3: 会議管理Lambda実装

**ファイル:**
- `services/meeting-api/recallMeetings.ts` - 会議管理Lambda関数

**API:**

#### 1. `POST /recall/meetings/join` (Facilitator用)
ボットを会議に参加させる。

**Request:**
```json
{
  "meetingUrl": "https://zoom.us/j/123456789",
  "platform": "zoom",
  "botName": "Timtam AI"
}
```

**Response:**
```json
{
  "meetingId": "bot-abc123",
  "meetingCode": "XYZ789",
  "status": "starting"
}
```

**処理:**
- Recall.ai API (`createBot`) を呼び出し
- 会議コード生成（6桁英数字）
- DynamoDB `meetings-metadata` に保存

#### 2. `GET /recall/meetings/{meetingId}` (Facilitator用)
会議状態を取得。

**Response:**
```json
{
  "meetingId": "bot-abc123",
  "platform": "recall",
  "status": "active",
  "recallBot": {
    "botId": "bot-abc123",
    "meetingUrl": "https://zoom.us/j/123456789",
    "platform": "zoom",
    "status": "in_meeting"
  }
}
```

**処理:**
- DynamoDBから会議情報取得
- オプションでRecall.ai APIからボット状態を同期

#### 3. `DELETE /recall/meetings/{meetingId}` (Facilitator用)
ボットを会議から退出させる。

**Response:**
```json
{
  "success": true
}
```

**処理:**
- Recall.ai API (`deleteBot`) を呼び出し
- DynamoDBの会議ステータスを `ended` に更新

#### 4. `GET /attendee/meetings/{code}` (Attendee用)
会議コードでmeetingIdを取得。

**Request:** `GET /attendee/meetings/XYZ789`

**Response:**
```json
{
  "meetingId": "bot-abc123",
  "status": "active"
}
```

**処理:**
- GSI `meetingCode-index` でクエリ
- meetingIdとstatusを返す

### M4: インフラ（CDK）実装

**ファイル:**
- `infra/cdk/lib/stack.ts` - CDKスタック更新

**変更内容:**

#### 1. DynamoDB GSI追加
`meetings-metadata` テーブルに `meetingCode-index` GSI追加。

```typescript
meetingsMetadataTable.addGlobalSecondaryIndex({
  indexName: 'meetingCode-index',
  partitionKey: { name: 'meetingCode', type: dynamodb.AttributeType.STRING },
  projectionType: dynamodb.ProjectionType.ALL,
});
```

#### 2. Lambda関数追加（5関数）
- `RecallWebhookFn` - Webhook処理
- `RecallJoinMeetingFn` - 会議参加
- `RecallGetMeetingFn` - 会議状態取得
- `RecallLeaveMeetingFn` - 会議退出
- `AttendeeGetMeetingByCodeFn` - コードでmeetingId取得

#### 3. API Gateway routes追加
- `POST /recall/webhook` - Webhook
- `POST /recall/meetings/join` - 会議参加
- `GET /recall/meetings/{meetingId}` - 会議状態取得
- `DELETE /recall/meetings/{meetingId}` - 会議退出
- `GET /attendee/meetings/{code}` - コードでmeetingId取得

#### 4. IAM権限付与
- SQS送信権限（recallWebhookFn）
- DynamoDB読み書き権限（会議管理Lambda）
- API Gateway呼び出し権限（全Lambda）

## DynamoDBスキーマ

### meetings-metadata テーブル

**既存:**
```typescript
{
  meetingId: string,         // PK
  // 既存フィールド（Chime用）
}
```

**Phase 2追加フィールド:**
```typescript
{
  meetingId: string,         // PK（Chime: meetingId, Recall: botId）
  platform: "chime" | "recall",
  status: "active" | "ended",
  createdAt: number,
  endedAt?: number,
  meetingCode?: string,      // Attendee用（GSI）

  // Recall固有フィールド
  recallBot?: {
    botId: string,
    meetingUrl: string,
    platform: "zoom" | "google_meet" | "teams" | "webex",
    botName: string,
    status: "starting" | "in_meeting" | "done" | "error",
    statusMessage?: string
  }
}
```

**GSI:**
- `meetingCode-index` (PK: meetingCode)

## 環境変数

Phase 2で追加された環境変数：

### Lambda関数

**recallWebhook, recallJoinMeeting, recallGetMeeting, recallLeaveMeeting:**
```
RECALL_API_KEY=<Recall.ai APIキー>  # TODO: Secrets Managerから取得
```

**recallJoinMeeting:**
```
RECALL_WEBHOOK_URL=<API Gateway URL>/recall/webhook  # TODO: デプロイ後に設定
```

**全Recall.ai Lambda:**
```
MEETINGS_METADATA_TABLE=timtam-meetings-metadata
TRANSCRIPT_QUEUE_URL=<SQS FIFO URL>
AI_MESSAGES_TABLE=timtam-ai-messages
```

## デプロイ手順

### 前提条件

1. **Recall.ai APIキー取得**
   - [Recall.ai Dashboard](https://dashboard.recall.ai/)でAPIキー作成
   - キーを安全な場所に保存

2. **環境変数設定**
   ```bash
   export RECALL_API_KEY="sk_live_YOUR_API_KEY_HERE"
   ```

### ビルド

```bash
# 共有ライブラリビルド
cd packages/shared
pnpm install
pnpm build

# サービスビルド
cd ../../services/meeting-api
pnpm install

cd ../orchestrator
pnpm install
pnpm build
```

### CDKデプロイ

```bash
cd ../../infra/cdk
npm install
cdk deploy
```

**デプロイ後:**
1. API Gateway URLを取得
2. `RECALL_WEBHOOK_URL` 環境変数を更新
3. 再デプロイ

```bash
# API Gateway URLを確認
export API_GATEWAY_URL=$(aws cloudformation describe-stacks --stack-name TimtamInfraStack --query 'Stacks[0].Outputs[?OutputKey==`HttpApiUrl`].OutputValue' --output text)

# RECALL_WEBHOOK_URLを設定して再デプロイ
export RECALL_WEBHOOK_URL="${API_GATEWAY_URL}/recall/webhook"
cdk deploy
```

## 動作確認

### 1. Zoom会議でテスト

```bash
# 1. ボットを参加させる
curl -X POST ${API_GATEWAY_URL}/recall/meetings/join \
  -H "Content-Type: application/json" \
  -d '{
    "meetingUrl": "https://zoom.us/j/123456789",
    "platform": "zoom",
    "botName": "Timtam AI"
  }'

# Response:
# {
#   "meetingId": "bot-abc123",
#   "meetingCode": "XYZ789",
#   "status": "starting"
# }

# 2. 会議で発言してWebhookを確認
# → CloudWatch Logsでrecall.webhook.receivedログを確認
# → SQSキューにTranscriptEventが送信されることを確認

# 3. 会議状態を取得
curl ${API_GATEWAY_URL}/recall/meetings/bot-abc123

# 4. ボットを退出させる
curl -X DELETE ${API_GATEWAY_URL}/recall/meetings/bot-abc123
```

### 2. Attendeeフローテスト

```bash
# 会議コードでmeetingId取得
curl ${API_GATEWAY_URL}/attendee/meetings/XYZ789

# Response:
# {
#   "meetingId": "bot-abc123",
#   "status": "active"
# }
```

## TODO（Phase 2未完了項目）

### セキュリティ

1. **Webhook署名検証**
   - `recallWebhook.ts`の`verifyWebhookSignature`関数を実装
   - Recall.ai Webhook secretをSecrets Managerに保存
   - HMAC-SHA256で署名を検証

2. **Secrets Manager統合**
   - Recall.ai APIキーをSecrets Managerに移行
   - CDKでSecrets Manager読み取り権限を付与
   - Lambda関数起動時にキーを取得

### 参加者イベント処理

- `participant.join` / `participant.leave` イベントをDynamoDBに保存
- Orchestratorで参加者追跡

### エラーハンドリング

- Recall.ai APIエラーのリトライロジック
- SQS送信失敗時のDLQ処理

## トラブルシューティング

### ボット作成失敗

**症状:** `createBot` API呼び出しが失敗

**原因候補:**
1. 不正なAPIキー
2. 会議URLが無効
3. Recall.aiのレート制限

**対処:**
- CloudWatch Logsでエラー詳細を確認
- Recall.ai Dashboardでボット状態を確認

### Webhookが受信されない

**症状:** 文字起こしイベントがSQSに届かない

**原因候補:**
1. `RECALL_WEBHOOK_URL`が未設定または誤っている
2. API Gateway URLが正しくない
3. Recall.aiボットが会議に参加していない

**対処:**
- `recallJoinMeeting` LambdaのCloudWatch Logsを確認
- `RECALL_WEBHOOK_URL`環境変数を確認
- Recall.ai Dashboardでボット状態を確認

### DynamoDB GSIクエリ失敗

**症状:** `GET /attendee/meetings/{code}`が404を返す

**原因候補:**
1. GSIが作成されていない
2. 会議コードが存在しない
3. GSIのプロビジョニングがまだ進行中

**対処:**
- AWS ConsoleでGSIステータスを確認
- DynamoDBテーブルにデータが存在するか確認

## 参考資料

### Recall.ai
- [Recall.ai Documentation](https://docs.recall.ai/)
- [Real-Time Webhook Endpoints](https://docs.recall.ai/docs/real-time-webhook-endpoints)
- [Bot Lifecycle](https://docs.recall.ai/docs/bot-lifecycle)

### ADRs
- [ADR 0014: 会議サービス抽象化レイヤー](./adr/0014-meeting-service-abstraction-layer.md)
- [ADR 0015: 会議ライフサイクル管理とUI設計](./adr/0015-meeting-lifecycle-and-ui-design.md)

### AWS
- [DynamoDB Global Secondary Indexes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html)
- [API Gateway HTTP API](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api.html)
