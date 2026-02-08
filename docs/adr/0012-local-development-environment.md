# ADR 0012: ローカル開発環境（ハイブリッドアプローチ）

- Status: Accepted
- Date: 2025-12-26
- Owners: timtam PoC チーム

## 背景 / Context

現在、timtamの開発・テスト環境はAWSにデプロイされた環境のみであり、以下の課題がある:

1. **開発速度の低下**: コード変更のたびに `cdk deploy` が必要（数分かかる）
2. **デバッグの困難さ**: CloudWatch Logsでの確認が必要、ローカルデバッガが使えない
3. **コスト**: 開発中も常にAWSリソース（DynamoDB、SQS、Lambda、ECS等）が課金される
4. **ネットワーク依存**: オフライン環境では開発不可

PoCフェーズでは迅速な変更とデバッグが重要であり、ローカル開発環境の構築が必要。

### 将来計画との整合性

以下のADRを考慮した設計が必要:
- **ADR 0011**: Kinesis Data Streams → SQS FIFOへの移行
- **ADR 0009**: Amazon Chime SDK → サードパーティ会議サービス（Zoom/Meet/Teams）への移行

特に、Chime SDKは将来的に削除予定（テスト専用）、Kinesisも SQS に置き換わるため、これらのローカル環境構築に投資すべきでない。

## 決定 / Decision

**ハイブリッドアプローチのローカル開発環境を採用する**

簡単にローカル化できるサービスはLocalStackで実行し、Bedrock等の高度なAWSサービスは本番環境をそのまま使用する。

### ローカル化するコンポーネント

| サービス | ローカル実装 | ツール |
|---------|------------|--------|
| DynamoDB | ✅ | LocalStack |
| SQS FIFO | ✅ | LocalStack |
| S3 | ✅ | LocalStack |
| Lambda関数 | ✅ | Node.js + Expressサーバー |
| ECS Orchestrator | ✅ | Docker |
| API Gateway | ✅ | Expressサーバー |

### AWSのまま使用するコンポーネント

| サービス | 理由 |
|---------|------|
| Bedrock | LLM品質が重要、ローカルLLMでは代替困難 |
| Polly | TTS品質、ローカル代替は品質が劣る |

### ローカル化しないコンポーネント

| サービス | 理由 |
|---------|------|
| Kinesis Data Streams | ADR 0011でSQSに移行予定 |
| Chime SDK | ADR 0009でサードパーティサービスに移行予定 |
| CloudFront | 開発時は `vite dev` で代替 |

## アーキテクチャ / Architecture

### システム構成図

```
┌─────────────────────────────────────────────────┐
│ ローカル開発環境（やっとむのPC/WSL）              │
│                                                 │
│  ┌──────────────┐                               │
│  │ Webブラウザ   │                               │
│  │ localhost:   │                               │
│  │ 5173         │                               │
│  └──────┬───────┘                               │
│         │                                        │
│         ↓                                        │
│  ┌──────────────────────┐                       │
│  │ Expressサーバー        │                       │
│  │ (API Gateway代替)    │                       │
│  │ localhost:3000       │                       │
│  │                      │                       │
│  │ - POST /meetings     │                       │
│  │ - POST /meetings/    │                       │
│  │   {id}/transcription/│                       │
│  │   events             │                       │
│  │ - GET /config        │                       │
│  │ - etc...             │                       │
│  └──────┬───────────────┘                       │
│         │                                        │
│         ↓                                        │
│  ┌──────────────────────┐                       │
│  │ Lambda関数            │                       │
│  │ (Node.jsプロセス)     │                       │
│  │                      │                       │
│  │ - createMeeting.ts   │                       │
│  │ - transcriptionEvents│                       │
│  │ - orchestratorConfig │                       │
│  │ - etc...             │                       │
│  └──────┬───────────────┘                       │
│         │                                        │
│         ↓                                        │
│  ┌──────────────────────┐                       │
│  │ LocalStack           │                       │
│  │ localhost:4566       │                       │
│  │                      │                       │
│  │ - DynamoDB           │                       │
│  │ - SQS FIFO           │                       │
│  │ - S3                 │                       │
│  └──────┬───────────────┘                       │
│         │                                        │
│         ↓                                        │
│  ┌──────────────────────┐                       │
│  │ ECS Orchestrator     │                       │
│  │ (Dockerコンテナ)      │                       │
│  │                      │                       │
│  │ - SQS polling        │                       │
│  │ - LLM judgment       │◄──────────┐           │
│  │ - DynamoDB write     │           │           │
│  └──────────────────────┘           │           │
│                                      │           │
└──────────────────────────────────────┼───────────┘
                                       │
                                       ↓
                            ┌──────────────────┐
                            │ AWS (本番環境)    │
                            │                  │
                            │ - Bedrock        │
                            │ - Polly          │
                            └──────────────────┘
```

### docker-compose.yml

```yaml
version: '3.8'

services:
  localstack:
    image: localstack/localstack:latest
    ports:
      - "4566:4566"  # LocalStack unified endpoint
    environment:
      - SERVICES=dynamodb,sqs,s3
      - DEBUG=1
      - DATA_DIR=/var/lib/localstack/data
    volumes:
      - "./localstack-data:/var/lib/localstack/data"
    networks:
      - timtam-local

  orchestrator:
    build: ./services/orchestrator
    environment:
      # LocalStack endpoint
      - AWS_ENDPOINT_URL=http://localstack:4566

      # SQS (ADR 0011対応)
      - TRANSCRIPT_QUEUE_URL=http://localstack:4566/000000000000/transcript-asr.fifo
      - CONTROL_SQS_URL=http://localstack:4566/000000000000/orchestrator-control

      # DynamoDB
      - AI_MESSAGES_TABLE=timtam-ai-messages
      - CONFIG_TABLE_NAME=timtam-orchestrator-config
      - MEETINGS_METADATA_TABLE=timtam-meetings-metadata

      # Bedrock (AWS本番環境)
      - BEDROCK_REGION=ap-northeast-1
      - BEDROCK_MODEL_ID=arn:aws:bedrock:ap-northeast-1:030046728177:inference-profile/global.anthropic.claude-haiku-4-5-20251001-v1:0

      # その他
      - WINDOW_LINES=5
      - POLL_INTERVAL_MS=1000
      - DEFAULT_PROMPT=会話の内容が具体的に寄りすぎていたり、抽象的になりすぎていたら指摘してください
    volumes:
      # AWS認証情報（Bedrock/Polly用）
      - "~/.aws:/root/.aws:ro"
    depends_on:
      - localstack
    networks:
      - timtam-local

networks:
  timtam-local:
    driver: bridge
```

### Expressサーバー（local-api-server.js）

```javascript
const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowedHeaders: ['*'],
}));
app.use(express.json());

// Lambda関数をインポート
const { handler: createMeeting } = require('./services/meeting-api/createMeeting');
const { handler: addAttendee } = require('./services/meeting-api/attendees');
const { handler: transcriptionEvents } = require('./services/meeting-api/transcriptionEvents');
const { handler: getConfig } = require('./services/config/handler');
const { handler: getPrompt } = require('./services/orchestrator-config/getPrompt');
const { handler: updatePrompt } = require('./services/orchestrator-config/updatePrompt');
// ... 他のLambda関数

// 環境変数を設定（LocalStack用）
process.env.AWS_ENDPOINT_URL = 'http://localhost:4566';
process.env.AI_MESSAGES_TABLE = 'timtam-ai-messages';
process.env.CONFIG_TABLE_NAME = 'timtam-orchestrator-config';
process.env.TRANSCRIPT_QUEUE_URL = 'http://localhost:4566/000000000000/transcript-asr.fifo';
// ... 他の環境変数

// API Gateway形式のイベントを作成するヘルパー
function createApiGatewayEvent(req) {
  return {
    body: JSON.stringify(req.body),
    headers: req.headers,
    httpMethod: req.method,
    pathParameters: req.params,
    queryStringParameters: req.query,
    requestContext: {
      requestId: Math.random().toString(36),
    },
  };
}

// ルート定義
app.post('/meetings', async (req, res) => {
  const event = createApiGatewayEvent(req);
  const result = await createMeeting(event, {});
  res.status(result.statusCode).json(JSON.parse(result.body));
});

app.post('/attendees', async (req, res) => {
  const event = createApiGatewayEvent(req);
  const result = await addAttendee(event, {});
  res.status(result.statusCode).json(JSON.parse(result.body));
});

app.post('/meetings/:meetingId/transcription/events', async (req, res) => {
  const event = createApiGatewayEvent(req);
  const result = await transcriptionEvents(event, {});
  res.status(result.statusCode).json(JSON.parse(result.body));
});

app.get('/config', async (req, res) => {
  const event = createApiGatewayEvent(req);
  const result = await getConfig(event, {});
  res.status(result.statusCode).json(JSON.parse(result.body));
});

app.get('/orchestrator/prompt', async (req, res) => {
  const event = createApiGatewayEvent(req);
  const result = await getPrompt(event, {});
  res.status(result.statusCode).json(JSON.parse(result.body));
});

app.put('/orchestrator/prompt', async (req, res) => {
  const event = createApiGatewayEvent(req);
  const result = await updatePrompt(event, {});
  res.status(result.statusCode).json(JSON.parse(result.body));
});

// ... 他のルート

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Local API server running on http://localhost:${PORT}`);
  console.log(`Using LocalStack at http://localhost:4566`);
});
```

### 開発フロー

```bash
# 1. (必要に応じて)イメージ再作成
docker compose build --no-cache

# 2. LocalStack + Orchestrator起動、DynamoDBテーブル・SQSキュー作成、初期データ投入
uv invoke run start-locak-dev

# 3. ブラウザで http://localhost:3001 にアクセス
```

### セットアップスクリプト（scripts/setup-localstack.sh）

```bash
#!/bin/bash
# LocalStackにDynamoDBテーブルとSQSキューを作成

ENDPOINT=http://localhost:4566

# DynamoDB テーブル作成
aws dynamodb create-table \
  --endpoint-url $ENDPOINT \
  --table-name timtam-ai-messages \
  --attribute-definitions AttributeName=meetingId,AttributeType=S AttributeName=timestamp,AttributeType=N \
  --key-schema AttributeName=meetingId,KeyType=HASH AttributeName=timestamp,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST

aws dynamodb create-table \
  --endpoint-url $ENDPOINT \
  --table-name timtam-meetings-metadata \
  --attribute-definitions AttributeName=meetingId,AttributeType=S \
  --key-schema AttributeName=meetingId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST

aws dynamodb create-table \
  --endpoint-url $ENDPOINT \
  --table-name timtam-orchestrator-config \
  --attribute-definitions AttributeName=configKey,AttributeType=S \
  --key-schema AttributeName=configKey,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST

# SQS FIFO キュー作成（ADR 0011対応）
aws sqs create-queue \
  --endpoint-url $ENDPOINT \
  --queue-name transcript-asr.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=true

aws sqs create-queue \
  --endpoint-url $ENDPOINT \
  --queue-name orchestrator-control

echo "LocalStack setup complete!"
```

## 影響 / Consequences

### ポジティブ

1. **開発速度の大幅向上**:
   - Lambda関数の変更: `cdk deploy`（数分） → Expressサーバー再起動（数秒）
   - DynamoDB/SQSのデータ確認: CloudWatchコンソール → ローカルCLI/GUI

2. **デバッグの容易化**:
   - ローカルデバッガ（VSCode等）が使用可能
   - `console.log`の出力が即座に確認可能
   - スタックトレースが完全に表示される

3. **コスト削減**:
   - DynamoDB、SQS、Lambda、API Gatewayの開発時課金なし
   - Bedrockのみ課金（開発時は最小限の使用）

4. **オフライン開発**:
   - Bedrock/Polly以外はインターネット不要
   - 移動中やネットワーク不安定時も開発可能

5. **ADR 0011/0009への対応**:
   - SQS FIFO環境が整う（Kinesis削除前に移行テスト可能）
   - Chime SDKのローカル環境不要（将来削除予定のため投資不要）

### ネガティブ

1. **初期セットアップコスト**:
   - docker-compose.yml作成
   - Expressサーバー実装（~100-200行）
   - セットアップスクリプト作成
   - 初回セットアップ: 1-2時間

2. **環境差異のリスク**:
   - LocalStackとAWSの挙動が完全に一致しない可能性
   - Bedrockは本番環境を使用するため、APIキー漏洩リスク

3. **メンテナンスコスト**:
   - Lambda関数追加時にExpressサーバーにもルート追加が必要
   - LocalStackのバージョンアップ対応

### リスク軽減策

**環境差異のリスク**:
- 本番デプロイ前に必ずAWS環境でテスト
- CI/CDで統合テストを実施

**Bedrock APIキー漏洩リスク**:
- `~/.aws/credentials`を読み取り専用でマウント
- `.gitignore`に`~/.aws`を追加（念のため）

**メンテナンスコスト**:
- Lambda関数追加時のチェックリストに「Expressサーバーへのルート追加」を含める
- 将来的にCDKからExpressルートを自動生成するスクリプトを検討

## 代替案 / Alternatives Considered

### 代替案A: フルローカル（Bedrockもローカル化）

**概要**: BedrockをOllama等のローカルLLMで代替

**却下理由**:
- ❌ ローカルLLMと本番Bedrockで応答品質が異なる
- ❌ Ollamaセットアップが複雑（数GBのモデルダウンロード）
- ❌ PoCフェーズではLLM品質が重要、代替品でのテストは不適切

### 代替案B: AWS SAM Local

**概要**: AWS SAM CLIの `sam local start-api` でLambda/API Gatewayをローカル実行

**却下理由**:
- ❌ SAM用のテンプレート作成が必要（現在はCDK使用）
- ❌ DynamoDB/SQS等は別途LocalStackが必要（結局Express同等の作業量）
- ❌ SAMの学習コスト

### 代替案C: AWS環境をそのまま使用（現状維持）

**概要**: ローカル環境を構築せず、AWS環境のみで開発

**却下理由**:
- ❌ 開発速度が遅い（`cdk deploy`が毎回必要）
- ❌ デバッグが困難
- ❌ コストが継続的に発生

### 代替案D: LocalStackのみ（Lambda/API Gatewayも含む）

**概要**: LocalStackの有料版でLambda/API Gatewayも実行

**却下理由**:
- ❌ 有料版が必要（Pro: $35/月〜）
- ❌ Lambda関数のホットリロードがExpressより遅い
- ❌ デバッガ接続が困難

## 実装計画 / Implementation Plan

### Phase 1: 基盤構築（1-2時間）

1. `docker-compose.yml`作成
2. `scripts/setup-localstack.sh`作成
3. LocalStack起動確認
4. DynamoDB/SQSテーブル/キュー作成確認

### Phase 2: Expressサーバー実装（1-2時間）

1. `local-api-server.js`作成
2. 主要エンドポイント実装:
   - `POST /meetings`
   - `POST /meetings/{id}/transcription/events`
   - `GET /config`
   - `GET /orchestrator/prompt`
   - `PUT /orchestrator/prompt`
3. CORS設定
4. エラーハンドリング

### Phase 3: Orchestratorのローカル実行（30分）

1. `docker-compose.yml`にOrchestratorサービス追加
2. 環境変数設定（LocalStack + AWS Bedrock）
3. 起動確認

### Phase 4: Webフロントエンドの接続（30分）

1. `web/facilitator/.env.local`作成
   ```
   NEXT_PUBLIC_API_URL=http://localhost:3000
   ```
2. 動作確認
3. E2Eテスト（会議作成→文字起こし→LLM応答）

### Phase 5: ドキュメント整備（30分）

1. `docs/local-development.md`作成
2. `README.md`にローカル開発セクション追加
3. トラブルシューティングガイド

### ロールバック計画

問題発生時は AWS環境での開発に戻す（現状維持）。ローカル環境は並行して整備を継続。

## 未決事項 / TBD

1. **LocalStackのデータ永続化**:
   - 現在はDockerボリュームで永続化
   - 開発データをgit管理するか（例: `localstack-data/seed.json`）

2. **Bedrockのモックモード**:
   - テスト時にBedrock APIを呼ばずモックレスポンスを返すオプションの追加
   - コスト削減とオフライン開発のため

3. **CI/CDへの統合**:
   - ローカル環境でのテストをGitHub Actionsに統合するか

4. **チーム開発時の設定共有**:
   - `.env.local`のサンプルファイル（`.env.local.example`）の作成

## 参考 / References

### 関連ツール・ドキュメント

- [LocalStack公式ドキュメント](https://docs.localstack.cloud/)
- [Express.js公式ドキュメント](https://expressjs.com/)
- [AWS SDK for JavaScript v3 - LocalStack設定](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/)
- [Docker Compose公式ドキュメント](https://docs.docker.com/compose/)

### 関連ADR

- ADR 0011: SQS FIFOへの移行（ローカル環境でSQS使用）
- ADR 0009: サードパーティ会議サービス統合（Chime SDKローカル環境不要の根拠）
- ADR 0003: コスト（開発時コスト削減の方針）

### 関連ファイル

- `infra/cdk/lib/stack.ts` - 本番環境のインフラ定義
- `services/meeting-api/*.ts` - Lambda関数（Expressサーバーから呼び出し）
- `services/orchestrator/Dockerfile` - Orchestratorコンテナ（ローカルでも使用）
