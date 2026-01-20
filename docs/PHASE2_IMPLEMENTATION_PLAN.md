# Phase 2実装計画: Recall.ai統合

このドキュメントは、Issue #45のPhase 2実装計画を詳細にまとめたものです。

## 📋 概要

Phase 2では、Recall.aiと接続して以下を実現します：

1. **Recall.ai API統合** - ボット作成・管理
2. **Webhook処理** - リアルタイム文字起こし受信
3. **RecallAdapter完全実装** - チャット送信
4. **会議管理API** - Lambda関数
5. **インフラ構築** - CDK, Secrets Manager
6. **動作確認** - Zoom/Meet/Teamsでテスト

## 🔧 セットアップ手順

### 1. Recall.aiアカウント作成

#### 1.1 サインアップ
- [Recall.ai](https://www.recall.ai/)にアクセス
- "Sign up"または"Get Started"をクリック
- メールアドレスとパスワードで登録、またはGitHub/Google認証を利用

#### 1.2 Workspace作成
- サインアップ後、Workspace名を設定
- リージョンを選択（推奨: `us-west-2`）
- プランを選択（開発用は無料プランで開始可能）

#### 1.3 APIキー取得
- ダッシュボードにログイン: https://dashboard.recall.ai/
- Settings → API Keys に移動
- "Create API Key"をクリック
- キー名を入力（例: `timtam-dev`）
- 生成されたAPIキーを安全な場所にコピー（**一度しか表示されない**）

例: `sk_live_1234567890abcdefghijklmnopqrstuvwxyz`

#### 1.4 リージョン確認
APIキー作成時にリージョンが表示されます：
- `us-west-2` (Oregon) - 推奨
- `us-east-1` (Virginia)
- `eu-central-1` (Frankfurt)
- `ap-northeast-1` (Tokyo)

### 2. AWS Secrets Manager設定

```bash
# Recall.ai APIキーをSecrets Managerに保存
aws secretsmanager create-secret \
  --name timtam/recall-api-key \
  --description "Recall.ai API key for timtam PoC" \
  --secret-string "sk_live_YOUR_API_KEY_HERE" \
  --region ap-northeast-1

# 後で取得する場合
aws secretsmanager get-secret-value \
  --secret-id timtam/recall-api-key \
  --region ap-northeast-1
```

### 3. Webhook URL準備

#### ローカル開発（ngrok使用）
```bash
# ngrokインストール（未インストールの場合）
brew install ngrok  # macOS
# または https://ngrok.com/download

# ngrok起動（ポート3000で待機）
ngrok http 3000

# 表示されるURLをメモ
# 例: https://abc123.ngrok.io
```

#### 本番環境
- CDKで作成するAPI Gateway URL
- 例: `https://api.timtam.example.com/recall/webhook`

## 📝 実装タスク

### Phase 2.1: RecallAdapter完全実装

**ファイル**: `packages/shared/src/adapters/RecallAdapter.ts`

#### 2.1.1: `postChat()` 実装

```typescript
async postChat(meetingId: MeetingId, message: string): Promise<void> {
  const url = `${this.apiBaseUrl}/api/v1/bot/${meetingId}/send_chat_message/`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${this.apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      message,
      pin_message: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Recall.ai Chat API error: ${response.status} ${errorText}`);
  }
}
```

#### 2.1.2: `postLlmCallLog()` 実装

DynamoDBへの書き込み（ChimeAdapterと同じロジック）：

```typescript
async postLlmCallLog(
  meetingId: MeetingId,
  prompt: string,
  rawResponse: string,
  nodeId: string = 'default'
): Promise<void> {
  const ddbClient = new DynamoDBDocumentClient(...);

  await ddbClient.send(new PutCommand({
    TableName: process.env.AI_MESSAGES_TABLE,
    Item: {
      meetingId,
      timestamp: Date.now(),
      type: 'llm_call',
      nodeId,
      prompt,
      rawResponse,
      ttl: Math.floor(Date.now() / 1000) + 86400, // 24時間
    },
  }));
}
```

### Phase 2.2: Webhook Lambda実装

**新規ファイル**: `services/meeting-api/recallWebhook.ts`

```typescript
import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { RecallAdapter } from '@timtam/shared';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const adapter = new RecallAdapter({
  apiKey: process.env.RECALL_API_KEY || '',
});

const sqs = new SQSClient({ region: process.env.AWS_REGION });
const TRANSCRIPT_QUEUE_URL = process.env.TRANSCRIPT_QUEUE_URL || '';

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const payload = JSON.parse(event.body || '{}');

  switch (payload.event) {
    case 'bot.transcript':
      const transcriptEvent = adapter.processInboundTranscript(payload.data);

      await sqs.send(new SendMessageCommand({
        QueueUrl: TRANSCRIPT_QUEUE_URL,
        MessageBody: JSON.stringify(transcriptEvent),
        MessageGroupId: transcriptEvent.meetingId,
        MessageDeduplicationId: payload.data.sequence_number?.toString(),
      }));
      break;

    case 'bot.participant_join':
    case 'bot.participant_leave':
      console.log('Participant event:', payload.event);
      break;

    case 'bot.status_change':
      console.log('Bot status changed:', payload.data.status);
      break;
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true }),
  };
};
```

### Phase 2.3: 会議管理Lambda実装

**新規ファイル**: `services/meeting-api/recallMeetings.ts`

#### POST /recall/meetings/join

```typescript
export const joinHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const { meetingUrl, platform, botName } = JSON.parse(event.body || '{}');

  // 1. Recall.ai APIでボット作成
  const recallResponse = await fetch('https://us-west-2.recall.ai/api/v1/bot/', {
    method: 'POST',
    headers: {
      'Authorization': `Token ${process.env.RECALL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      meeting_url: meetingUrl,
      bot_name: botName || 'Timtam AI',
      transcription_options: {
        provider: 'recall',
        realtime: true,
        partial_results: true,
      },
      real_time_transcription: {
        destination_url: process.env.WEBHOOK_URL + '/recall/webhook',
      },
    }),
  });

  const bot = await recallResponse.json();
  const meetingCode = generateMeetingCode();

  // 2. DynamoDBに保存
  await ddbClient.send(new PutCommand({
    TableName: process.env.MEETINGS_METADATA_TABLE,
    Item: {
      meetingId: bot.id,
      platform: 'recall',
      status: 'active',
      createdAt: Date.now(),
      meetingCode,
      recallBot: {
        botId: bot.id,
        meetingUrl,
        platform,
        botName: botName || 'Timtam AI',
        status: bot.status,
      },
    },
  }));

  return {
    statusCode: 200,
    body: JSON.stringify({
      meetingId: bot.id,
      meetingCode,
      status: bot.status,
    }),
  };
};
```

#### DELETE /recall/meetings/{meetingId}

```typescript
export const leaveHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const meetingId = event.pathParameters?.meetingId;

  // 1. DynamoDBから会議メタデータ取得
  const meeting = await ddbClient.send(new GetCommand({
    TableName: process.env.MEETINGS_METADATA_TABLE,
    Key: { meetingId },
  }));

  if (!meeting.Item) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Meeting not found' }) };
  }

  const botId = meeting.Item.recallBot.botId;

  // 2. Recall.ai APIでボット削除
  await fetch(`https://us-west-2.recall.ai/api/v1/bot/${botId}/`, {
    method: 'DELETE',
    headers: { 'Authorization': `Token ${process.env.RECALL_API_KEY}` },
  });

  // 3. DynamoDB更新
  await ddbClient.send(new UpdateCommand({
    TableName: process.env.MEETINGS_METADATA_TABLE,
    Key: { meetingId },
    UpdateExpression: 'SET #status = :status, endedAt = :endedAt',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':status': 'ended',
      ':endedAt': Date.now(),
    },
  }));

  return { statusCode: 200, body: JSON.stringify({ success: true }) };
};
```

### Phase 2.4: インフラ（CDK）実装

**ファイル**: `infra/lib/timtam-stack.ts`

```typescript
// DynamoDB: meetings-metadata テーブル
const meetingsMetadataTable = new dynamodb.Table(this, 'MeetingsMetadata', {
  tableName: 'timtam-meetings-metadata',
  partitionKey: { name: 'meetingId', type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});

// GSI: meetingCode → meetingId
meetingsMetadataTable.addGlobalSecondaryIndex({
  indexName: 'meetingCode-index',
  partitionKey: { name: 'meetingCode', type: dynamodb.AttributeType.STRING },
  projectionType: dynamodb.ProjectionType.ALL,
});

// Secrets Manager
const recallApiKeySecret = secretsmanager.Secret.fromSecretNameV2(
  this,
  'RecallApiKey',
  'timtam/recall-api-key'
);

// Lambda: Webhook handler
const recallWebhookLambda = new lambda.Function(this, 'RecallWebhook', {
  functionName: 'timtam-recall-webhook',
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'recallWebhook.handler',
  code: lambda.Code.fromAsset('dist/meeting-api'),
  environment: {
    TRANSCRIPT_QUEUE_URL: transcriptQueue.queueUrl,
    RECALL_API_KEY: recallApiKeySecret.secretValue.toString(),
  },
  timeout: cdk.Duration.seconds(30),
});

// API Gateway routes
api.addRoutes({
  path: '/recall/webhook',
  methods: [apigw.HttpMethod.POST],
  integration: new integrations.HttpLambdaIntegration('RecallWebhook', recallWebhookLambda),
});
```

## 🧪 動作確認・テスト戦略

### ステップ1: ローカル開発環境

1. **ngrokでWebhookエンドポイント公開**
   ```bash
   sam local start-api --port 3000
   ngrok http 3000
   ```

2. **ボット作成テスト**
   ```bash
   curl -X POST https://us-west-2.recall.ai/api/v1/bot/ \
     -H "Authorization: Token $RECALL_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "meeting_url": "https://meet.google.com/your-meeting",
       "bot_name": "Timtam Test Bot",
       "transcription_options": {
         "provider": "recall",
         "realtime": true,
         "partial_results": true
       },
       "real_time_transcription": {
         "destination_url": "https://abc123.ngrok.io/recall/webhook"
       }
     }'
   ```

3. **Webhook受信確認**
   - Google Meetにアクセス
   - ボット参加を確認
   - ngrokコンソールでWebhook確認
   - Lambda関数ログで文字起こし確認

### ステップ2: 本番環境

1. **CDKデプロイ**
   ```bash
   cd infra
   cdk deploy TimtamStack
   ```

2. **各プラットフォームでテスト**
   - Zoom会議
   - Google Meet
   - Microsoft Teams

### ステップ3: エンドツーエンドテスト

```
Facilitator UI → ボット参加 → 発言 → Webhook → Lambda → SQS
→ Orchestrator → Grasp → LLM → 介入判定 → RecallAdapter.postChat
→ 会議チャット → Facilitator UIで確認
```

### トラブルシューティング

**ボットが会議に参加しない:**
- Recall.ai APIレスポンス確認
- 会議URL/プラットフォーム指定確認

**Webhookが受信されない:**
- URL確認
- Recall.aiダッシュボードでボット状態確認
- CloudWatch Logs確認

**文字起こしがOrchestratorに届かない:**
- SQSキューメッセージ数確認
- Lambda→SQS書き込み確認
- Orchestratorポーリング確認

## 📊 実装マイルストーン

### M1: RecallAdapter完全実装（1週間）
- [ ] `postChat()` 実装・テスト
- [ ] `postLlmCallLog()` 実装・テスト
- [ ] 単体テスト作成

### M2: Webhook処理（1週間）
- [ ] `recallWebhook.ts` 実装
- [ ] Webhook署名検証
- [ ] SQS統合
- [ ] ローカルテスト（ngrok）

### M3: 会議管理API（1週間）
- [ ] `POST /recall/meetings/join` 実装
- [ ] `DELETE /recall/meetings/{meetingId}` 実装
- [ ] `GET /recall/meetings/{meetingId}` 実装
- [ ] DynamoDB統合

### M4: インフラ構築（3-4日）
- [ ] DynamoDB `meetings-metadata` テーブル
- [ ] GSI `meetingCode-index`
- [ ] Lambda関数デプロイ
- [ ] API Gateway routes
- [ ] Secrets Manager統合

### M5: 動作確認（1週間）
- [ ] Zoomでテスト
- [ ] Google Meetでテスト
- [ ] Microsoft Teamsでテスト
- [ ] エンドツーエンドテスト
- [ ] パフォーマンス・レイテンシ測定

**Phase 2完了予定**: 3-4週間

## 🔗 参考リソース

### Recall.ai公式ドキュメント
- [Getting Started](https://docs.recall.ai/docs/getting-started)
- [Authentication](https://docs.recall.ai/reference/authentication)
- [Real-Time Webhook Endpoints](https://docs.recall.ai/docs/real-time-webhook-endpoints)
- [Quickstart: Record a meeting](https://docs.recall.ai/docs/quickstart)
- [Webhooks Overview](https://docs.recall.ai/reference/webhooks-overview)

### AWS関連
- [AWS Lambda Best Practices](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html)
- [AWS Secrets Manager](https://docs.aws.amazon.com/secretsmanager/)
- [DynamoDB Global Secondary Indexes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html)

### 開発ツール
- [ngrok](https://ngrok.com/) - ローカルWebhookテスト用
- [Postman](https://www.postman.com/) - API動作確認用

## 関連ドキュメント
- [ADR 0014: 会議サービス抽象化レイヤー](./adr/0014-meeting-service-abstraction-layer.md)
- [ADR 0015: 会議ライフサイクル管理とUI設計](./adr/0015-meeting-lifecycle-and-ui-design.md)
- [Issue #45](https://github.com/yattom/timtam/issues/45)
