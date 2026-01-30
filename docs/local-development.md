# ローカル開発環境セットアップガイド

このドキュメントでは、Timtamのローカル開発環境のセットアップと使用方法を説明する。

## 概要

ローカル開発環境は以下のコンポーネントで構成される:

- **LocalStack**: DynamoDB、SQS、S3をローカルで実行
- **Recall.ai Stub Server**: Recall.ai APIをモックし、Web UIから文字起こしを送信
- **Express API Server**: Lambda関数をローカルで実行（localhost:3000）
- **ECS Orchestrator**: Dockerコンテナで実行（TODO）

詳細な設計については [ADR 0016](./adr/0016-local-development-environment-recall-stub.md) を参照。

## 前提条件

以下がインストールされていること:

- Docker Desktop (または Docker + Docker Compose)
- AWS CLI
- jq
- Node.js 18以上
- pnpm

## セットアップ手順

### 1. リポジトリをクローン

```bash
git clone https://github.com/yattom/timtam.git
cd timtam
```

### 2. 依存関係をインストール

```bash
pnpm install
```

### 3. LocalStack + Recall.ai Stub Serverを起動

```bash
docker-compose up
```

初回起動時は、Dockerイメージのビルドに数分かかる。

### 4. LocalStackにリソースを作成

別のターミナルで以下を実行:

```bash
chmod +x scripts/setup-localstack.sh
./scripts/setup-localstack.sh
```

このスクリプトは以下のリソースを作成する:

- DynamoDBテーブル: `timtam-meetings-metadata`, `timtam-ai-messages`, `timtam-orchestrator-config`
- SQS FIFOキュー: `transcript-asr.fifo`
- S3バケット: `timtam-local-dev`

### 5. 環境のテスト（推奨）

セットアップが正しく完了したか確認するため、テストスクリプトを実行:

```bash
./scripts/test-local-dev-env.sh
```

このスクリプトは以下をテストする:

- Dockerデーモンの起動確認
- LocalStackとRecall stubのコンテナ起動確認
- ヘルスエンドポイントの応答確認
- DynamoDBテーブル、SQSキュー、S3バケットの作成確認
- Recall stub API（ボット作成、情報取得、メッセージ送信）の動作確認
- Web UIのアクセス確認

全てのテストがパスすれば、ローカル開発環境は正常に動作している。

**期待される出力:**

```
=========================================
Test Summary
=========================================
Total tests: 13
Passed: 13
Failed: 0

✓ All tests passed! Local development environment is working correctly.
```

テストが失敗した場合は、エラーメッセージを確認して修正する。

### 6. 環境変数を設定

Webフロントエンド用の環境変数を設定:

```bash
cd web/facilitator
cp .env.example .env.local
```

`.env.local` を編集:

```env
# ローカルAPI Server
VITE_API_BASE_URL=http://localhost:3000

# 本番APIを使用する場合はこちら
# VITE_API_BASE_URL=https://your-api-gateway-url.execute-api.ap-northeast-1.amazonaws.com
```

### 7. Webフロントエンドを起動

```bash
cd web/facilitator
pnpm dev
```

ブラウザで http://localhost:5173 を開く。

## 使い方

### 会議を作成

1. Facilitator UI (http://localhost:5173) を開く
2. 「新しい会議を作成」をクリック
3. **ミーティングURL**: `http://localhost` と入力（重要！）
4. プラットフォーム: `zoom` を選択（任意）
5. ボット名: 任意の名前を入力

### 文字起こしを送信

1. Recall.ai Stub Server UI (http://localhost:8080) を開く
2. 作成したボットが一覧に表示される
3. ボットを選択
4. 話者名を入力（例: `田中太郎`）
5. テキストを入力（例: `今日の会議の目的は、プロジェクトの進捗を確認することです。`）
6. 「📤 Webhookに送信」ボタンをクリック

### AI応答を確認

- Stub Server UIの「Chat Log」セクションにAI応答が表示される
- Orchestratorが文字起こしを処理し、LLMで判断後、RecallAdapter経由でメッセージを送信する

## アーキテクチャ

```
┌─────────────────────────────────────────────┐
│ Facilitator UI (localhost:5173)             │
│ - 会議作成                                   │
│ - ミーティングURL: "localhost"              │
└──────────────┬──────────────────────────────┘
               │
               ↓
┌─────────────────────────────────────────────┐
│ Recall.ai Stub Server (localhost:8080)      │
│ - Mock API                                  │
│ - Web UI (文字起こし送信)                    │
└──────────────┬──────────────────────────────┘
               │
               ↓ Webhook
┌─────────────────────────────────────────────┐
│ Express API Server (localhost:3000)         │
│ - Lambda関数をローカル実行                   │
└──────────────┬──────────────────────────────┘
               │
               ↓
┌─────────────────────────────────────────────┐
│ LocalStack (localhost:4566)                 │
│ - DynamoDB, SQS, S3                         │
└──────────────┬──────────────────────────────┘
               │
               ↓
┌─────────────────────────────────────────────┐
│ ECS Orchestrator (Docker) [TODO]            │
│ - SQSポーリング                              │
│ - Grasp実行                                 │
│ - LLM判断 (Bedrock)                         │
│ - RecallAdapter → Stub Chat API             │
└─────────────────────────────────────────────┘
```

## 利用可能なエンドポイント

### Recall.ai Stub Server (http://localhost:8080)

- `GET /` - Web UI
- `POST /api/v1/bot/` - ボット作成
- `GET /api/v1/bot/:bot_id/` - ボット情報取得
- `POST /api/v1/bot/:bot_id/send_chat_message/` - チャットメッセージ送信
- `POST /api/v1/bot/:bot_id/leave_call/` - ボット退出
- `GET /health` - ヘルスチェック

### LocalStack (http://localhost:4566)

- DynamoDB: `http://localhost:4566`
- SQS: `http://localhost:4566`
- S3: `http://localhost:4566`

AWS CLIでアクセスする場合:

```bash
aws dynamodb list-tables --endpoint-url http://localhost:4566 --region ap-northeast-1
aws sqs list-queues --endpoint-url http://localhost:4566 --region ap-northeast-1
```

## トラブルシューティング

### 環境の動作確認

問題が発生した場合、まずテストスクリプトを実行して何が問題かを特定する:

```bash
./scripts/test-local-dev-env.sh
```

このスクリプトが失敗したテストを表示し、どのコンポーネントに問題があるか教えてくれる。

### LocalStackが起動しない

```bash
# Dockerログを確認
docker-compose logs localstack

# コンテナを再起動
docker-compose restart localstack
```

### Recall.ai Stub Serverが起動しない

```bash
# Dockerログを確認
docker-compose logs recall-stub

# イメージを再ビルド
docker-compose build recall-stub
docker-compose up recall-stub
```

### ボットが作成されない

1. Facilitator UIで「localhost」をミーティングURLとして指定したか確認
2. Stub Server UIでボット一覧を確認
3. Stub Serverのログを確認: `docker-compose logs recall-stub`

### Webhookが送信されない

1. API Serverが起動しているか確認: `docker-compose ps api-server`
2. Stub Serverのログでエラーを確認
3. WEBHOOK_URL環境変数が正しく設定されているか確認

### DynamoDBテーブルが見つからない

```bash
# セットアップスクリプトを再実行
./scripts/setup-localstack.sh

# テーブル一覧を確認
aws dynamodb list-tables --endpoint-url http://localhost:4566 --region ap-northeast-1
```

## 開発のヒント

### ログを確認する

```bash
# すべてのコンテナのログ
docker-compose logs -f

# 特定のコンテナのログ
docker-compose logs -f recall-stub
docker-compose logs -f localstack
```

### LocalStackのデータを削除する

```bash
# コンテナを停止
docker-compose down

# ボリュームを削除
rm -rf localstack-data/

# 再起動
docker-compose up
./scripts/setup-localstack.sh
```

### Stub Serverの開発

```bash
# コンテナ外でローカル起動
cd stub-recall-server
npm install
npm run dev

# ファイル変更時に自動再起動（nodemon）
```

## 本番環境との違い

| 項目 | ローカル環境 | 本番環境 |
|------|-------------|---------|
| Recall.ai | Stub Server | 本番クラウドサービス |
| 会議サービス | 不要（Stubで代替） | Zoom/Meet/Teams |
| DynamoDB/SQS | LocalStack | AWS |
| Lambda | Express (localhost:3000) | AWS Lambda |
| Orchestrator | Docker | ECS |
| コスト | $0（Bedrock除く） | 従量課金 |

## 次のステップ

現在、以下のコンポーネントが未実装:

1. **Orchestratorのローカル化**: Docker Composeに統合

これらの実装については、Issue #21 を参照。

## 参考

- [ADR 0016: ローカル開発環境（Recall.ai対応版）](./adr/0016-local-development-environment-recall-stub.md)
- [Recall.ai API Documentation](https://docs.recall.ai/reference/)
- [LocalStack Documentation](https://docs.localstack.cloud/)
