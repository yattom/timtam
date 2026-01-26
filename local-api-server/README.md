# Local API Server

ローカル開発環境用のAPI Server。Lambda関数のロジックをExpressで実装し、LocalStackのDynamoDB/SQS/S3に接続する。

## セットアップ

```bash
cd local-api-server
pnpm install
```

## 起動方法

```bash
# 開発モード（ホットリロード）
pnpm dev

# ビルド
pnpm build

# 本番モード
pnpm start
```

## 環境変数

- `PORT`: サーバーポート（デフォルト: 3000）
- `AWS_ENDPOINT_URL`: LocalStackエンドポイント（デフォルト: http://localhost:4566）
- `AWS_REGION`: AWSリージョン（デフォルト: ap-northeast-1）
- `MEETINGS_METADATA_TABLE`: DynamoDBテーブル名（デフォルト: timtam-meetings-metadata）

## エンドポイント

### Health Check
```
GET /health
```

### Recall/Meeting API
```
GET /recall/meetings?limit=50&nextToken=xxx
```

## 開発のヒント

- Lambda関数のロジックを `src/` 以下に移植
- LocalStackへの接続は環境変数で設定
- CORS有効化済み（Facilitator UIから呼び出し可能）
