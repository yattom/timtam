# Timtam

AI会議ファシリテーター PoC

## 概要

TimtamはZoom/Google Meet/Microsoft Teams会議に参加し、リアルタイムで文字起こしを分析してファシリテーションを行うAIアシスタント。

### 主な機能

- リアルタイム文字起こし（Recall.ai経由）
- 会議の流れを理解し、適切なタイミングで介入
- Grasp（発話の意図理解）による文脈把握
- LLM（Claude）による判断とファシリテーション

## アーキテクチャ

```
Zoom/Meet/Teams
    ↓
Recall.ai (ボット参加 + 文字起こし)
    ↓ Webhook
Lambda (recallWebhook)
    ↓
SQS FIFO Queue
    ↓
ECS Orchestrator
  - Grasp実行
  - LLM判断
  - RecallAdapter → Chat送信
```

## 開発環境

### 本番環境（AWS）

```bash
# デプロイ
cd infra/cdk
pnpm run deploy
```

### ローカル開発環境

完全にオフラインで開発可能なローカル環境を提供。Recall.aiやAWSへの接続不要で、文字起こしのテストが可能。

```bash
# LocalStack + Recall.ai Stub Serverを起動
docker-compose up

# LocalStackにリソースを作成
./scripts/setup-localstack.sh

# 環境のテスト（推奨）
./scripts/test-local-dev-env.sh

# Webフロントエンドを起動
cd web/facilitator
pnpm dev
```

詳細は [ローカル開発環境ガイド](./docs/local-development.md) を参照。

## プロジェクト構成

```
timtam/
├── docs/                  # ドキュメント
│   ├── adr/              # Architecture Decision Records
│   └── local-development.md
├── infra/                # インフラ（AWS CDK）
│   └── cdk/
├── services/             # バックエンドサービス
│   ├── orchestrator/     # ECS Orchestrator
│   ├── meeting-api/      # Lambda関数
│   └── admin-api/        # 管理API
├── packages/             # 共有パッケージ
│   └── shared/           # 共通ライブラリ
├── web/                  # Webフロントエンド
│   └── facilitator/      # Facilitator UI (React)
├── stub-recall-server/   # ローカル開発用Recall.aiスタブ
├── scripts/              # スクリプト
└── docker-compose.yml    # ローカル開発環境
```

## ドキュメント

- [ローカル開発環境セットアップガイド](./docs/local-development.md)
- [ADR 0016: ローカル開発環境（Recall.ai対応版）](./docs/adr/0016-local-development-environment-recall-stub.md)
- [ADR 0014: 会議サービス抽象化レイヤー](./docs/adr/0014-meeting-service-abstraction-layer.md)
- [Orchestrator README](./services/orchestrator/README.md)

## 技術スタック

- **フロントエンド**: React, TypeScript, Vite
- **バックエンド**: Node.js, TypeScript, AWS Lambda, ECS
- **インフラ**: AWS CDK
- **AI/LLM**: Amazon Bedrock (Claude)
- **会議サービス**: Recall.ai
- **データベース**: DynamoDB
- **メッセージング**: SQS FIFO
- **ローカル開発**: LocalStack, Docker Compose

## ライセンス

（未定）
