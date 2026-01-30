# Local API Server

ローカル開発環境用のAPI Server。既存のLambda関数をExpressでラップし、LocalStackのDynamoDB/SQS/S3に接続する。

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

## アーキテクチャ

このサーバーは `services/` 配下の既存のLambdaハンドラーを直接ラップして呼び出す。

- ExpressのリクエストをAPI Gateway Eventに変換
- 既存のLambdaハンドラー（`services/meeting-api/recallMeetings.ts` など）を直接実行
- LocalStackへの接続は環境変数で設定
- CORS有効化済み（Facilitator UIから呼び出し可能）

変更を加える場合は、`services/` 配下のLambdaハンドラーを直接編集する。ルーティングは `src/index.ts` で定義されている。
