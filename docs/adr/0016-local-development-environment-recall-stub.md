# ADR 0016: ローカル開発環境（Recall.ai対応版）

- Status: Proposed
- Date: 2026-01-25
- Owners: timtam PoC チーム
- Related: [ADR 0012](./0012-local-development-environment.md), [ADR 0014](./0014-meeting-service-abstraction-layer.md)

## 背景 / Context

ADR 0012で決定したローカル開発環境の基本アーキテクチャ（LocalStack + Express サーバー）は、Amazon Chime SDKを前提として設計されていた。しかし、Phase 2でRecall.ai統合が実装され、システムの構成が大きく変化した:

### 現在の本番環境アーキテクチャ（Recall.ai対応後）

```
┌──────────────────────────────────────────────┐
│ Zoom/Meet/Teams会議                           │
│                                              │
│  ┌────────────┐                              │
│  │ユーザー     │                              │
│  └──────┬─────┘                              │
│         │ 音声                                │
└─────────┼──────────────────────────────────────┘
          ↓
┌──────────────────────────────────────────────┐
│ Recall.ai (クラウドサービス)                   │
│                                              │
│  ┌────────────────┐                          │
│  │ Bot            │                          │
│  │ - 文字起こし    │                          │
│  │ - Webhook送信  │                          │
│  │ - Chat API     │                          │
│  └────────┬───────┘                          │
└───────────┼──────────────────────────────────┘
            │
            ↓ Webhook (transcript.data)
┌──────────────────────────────────────────────┐
│ AWS環境                                       │
│                                              │
│  ┌─────────────────────────────┐             │
│  │ Lambda: recallWebhook       │             │
│  │ - Recall形式 → TranscriptEvent│            │
│  │ - SQSに送信                 │             │
│  └──────────┬──────────────────┘             │
│             ↓                                │
│  ┌─────────────────────────────┐             │
│  │ SQS FIFO Queue              │             │
│  │ (統一フォーマット)            │             │
│  └──────────┬──────────────────┘             │
│             ↓                                │
│  ┌─────────────────────────────┐             │
│  │ ECS Orchestrator            │             │
│  │ - SQSポーリング              │             │
│  │ - Grasp実行                 │             │
│  │ - LLM判断                   │             │
│  │ - RecallAdapter → Chat API  │             │
│  └──────────┬──────────────────┘             │
│             │                                │
│  ┌─────────┴──────────┐                      │
│  │ DynamoDB           │                      │
│  │ - meetings-metadata│                      │
│  │ - ai-messages (log)│                      │
│  └────────────────────┘                      │
└──────────────────────────────────────────────┘
```

### ローカル開発環境の課題

ADR 0012の設計では以下の課題がある:

1. **Recall.aiへの依存**
   - 本番のRecall.aiサービスを呼び出す必要がある
   - 実際のZoom/Meet/Teams会議が必要
   - 開発のたびにクラウドコストが発生
   - オフライン開発不可

2. **Recall.ai Webhookの受信**
   - LocalStackはWebhook受信機能を提供しない
   - ローカル環境でWebhookを受信する仕組みが必要

3. **会議サービスのモック**
   - 実際の会議を立ち上げずにテストしたい
   - 文字起こしの入力を手動でコントロールしたい
   - デバッグのために特定のシナリオを再現したい

## 決定 / Decision

**Recall.ai Stub Serverを構築し、ローカル開発環境を完全にオフライン化する**

### 基本方針

1. **Recall.ai Stub Server**を実装
   - Recall.ai APIの主要エンドポイントをモック
   - 簡易UIから文字起こしイベントを手動送信
   - 特殊なミーティングURL（`localhost`）で起動

2. **既存のLocalStack + Expressサーバー**アーキテクチャを継承
   - DynamoDB、SQS、S3はLocalStackで実行
   - Lambda関数はExpressサーバーで実行
   - ECS OrchestratorはDockerで実行

3. **完全オフライン開発**
   - Bedrock/Polly以外はインターネット不要
   - Bedrockもモックモード追加（オプション）

## アーキテクチャ / Architecture

### システム構成図

```
┌──────────────────────────────────────────────────────────┐
│ ローカル開発環境（やっとむのPC/WSL）                        │
│                                                          │
│  ┌────────────────────────────────────────────┐          │
│  │ Recall.ai Stub Server (localhost:8080)     │          │
│  │                                            │          │
│  │  ┌──────────────────────────────┐          │          │
│  │  │ Web UI                       │          │          │
│  │  │ - ミーティング管理             │          │          │
│  │  │ - 文字起こし入力フォーム        │          │          │
│  │  │ - Webhook送信ボタン           │          │          │
│  │  └──────────────────────────────┘          │          │
│  │                                            │          │
│  │  ┌──────────────────────────────┐          │          │
│  │  │ Mock Recall.ai API           │          │          │
│  │  │ POST /api/v1/bot/            │          │          │
│  │  │ GET  /api/v1/bot/{id}/       │          │          │
│  │  │ POST /api/v1/bot/{id}/       │          │          │
│  │  │      send_chat_message/      │          │          │
│  │  │ POST /api/v1/bot/{id}/       │          │          │
│  │  │      leave_call/             │          │          │
│  │  └──────────┬───────────────────┘          │          │
│  │             │                              │          │
│  │             ↓ Webhook送信                  │          │
│  └─────────────┼──────────────────────────────┘          │
│                │                                         │
│                ↓                                         │
│  ┌────────────────────────────────────────────┐          │
│  │ Express API Server (localhost:3000)        │          │
│  │                                            │          │
│  │  POST /recall/meetings/join                │          │
│  │  GET  /recall/meetings/{meetingId}         │          │
│  │  DELETE /recall/meetings/{meetingId}       │          │
│  │  POST /recall/webhook ◄────────────────────┼──────────┘
│  │                                            │
│  │  (その他のエンドポイント)                    │
│  │  GET  /config                              │
│  │  GET  /orchestrator/prompt                 │
│  │  PUT  /orchestrator/prompt                 │
│  └────────────┬───────────────────────────────┘
│               │
│               ↓
│  ┌────────────────────────────────────────────┐
│  │ LocalStack (localhost:4566)                │
│  │                                            │
│  │  - DynamoDB (timtam-meetings-metadata)     │
│  │  - DynamoDB (timtam-ai-messages)           │
│  │  - SQS FIFO (transcript-asr.fifo)          │
│  │  - S3                                      │
│  └────────────┬───────────────────────────────┘
│               │
│               ↓
│  ┌────────────────────────────────────────────┐
│  │ ECS Orchestrator (Dockerコンテナ)           │
│  │                                            │
│  │  - SQSポーリング (LocalStack)               │
│  │  - Grasp実行                               │
│  │  - LLM判断 (Bedrock or Mock)               │
│  │  - RecallAdapter → Stub Chat API           │
│  └────────────────────────────────────────────┘
│                                                          │
│  ┌────────────────────────────────────────────┐          │
│  │ Webフロントエンド (localhost:5173)           │          │
│  │ - Facilitator UI                           │          │
│  └────────────────────────────────────────────┘          │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

## 実装計画 / Implementation Plan

### Phase 1: Recall.ai Stub Server実装（4-6時間）

1. **基本構造構築**（1時間）
   - `stub-recall-server/` ディレクトリ作成
   - Express + Socket.io セットアップ
   - Dockerfile作成

2. **Mock API実装**（2時間）
   - `POST /api/v1/bot/`
   - `GET /api/v1/bot/{id}/`
   - `POST /api/v1/bot/{id}/send_chat_message/`
   - `POST /api/v1/bot/{id}/leave_call/`

3. **Web UI実装**（2-3時間）
   - ボット一覧表示
   - 文字起こし入力フォーム
   - Chat Log表示
   - WebSocketリアルタイム更新

### Phase 2: docker-compose.yml作成（1時間）

1. LocalStackサービス定義
2. Recall Stubサービス定義
3. API Serverサービス定義
4. Orchestratorサービス定義
5. ネットワーク設定

### Phase 3: 既存コード修正（1時間）

1. `RecallAPIClient` で `apiBaseUrl` をサポート
2. `recallMeetings.ts` で `localhost` URL判定
3. 環境変数追加（`.env.local.example`）

### Phase 4: テスト＆ドキュメント（2時間）

1. E2Eテスト（会議作成→文字起こし→AI応答）
2. `docs/local-development.md` 作成
3. トラブルシューティングガイド

### 総所要時間: 8-10時間

## 影響 / Consequences

### ポジティブ

1. **完全オフライン開発**
   - Recall.aiクラウドサービス不要
   - 実際のZoom/Meet/Teams会議不要
   - Bedrock以外はインターネット接続不要

2. **開発速度の大幅向上**
   - コード変更 → Docker再起動（数秒）
   - 文字起こしを手動で即座に送信可能
   - デバッグが容易（ローカルデバッガ使用可能）

3. **コスト削減**
   - Recall.ai課金なし（$0.85/時間 → $0）
   - DynamoDB/SQS/Lambda課金なし
   - Bedrockのみ課金（モックモード使用時は$0）

4. **テストシナリオの再現性**
   - 特定の文字起こしシーケンスを繰り返しテスト可能
   - エッジケース（長文、特殊文字、連続発話）の検証が容易

5. **ADR 0012との一貫性**
   - LocalStack、Express、Docker構成を継承
   - 既存の設計思想を維持

### ネガティブ

1. **Stub Serverのメンテナンスコスト**
   - Recall.ai APIの変更に追従が必要
   - ただし、開発時のみ使用するため影響は限定的

2. **本番環境との差異**
   - Stubは完全な再現ではない
   - 本番デプロイ前に必ずAWS環境でテスト必要

3. **初期セットアップコスト**
   - Stub Server実装: ~4-6時間
   - docker-compose.yml更新: ~1時間
   - ドキュメント作成: ~1時間

## 参考 / References

### 関連ADR

- [ADR 0012: ローカル開発環境（ハイブリッドアプローチ）](./0012-local-development-environment.md)
- [ADR 0014: 会議サービス抽象化レイヤー](./0014-meeting-service-abstraction-layer.md)
- [ADR 0009: サードパーティ会議サービス統合](./0009-third-party-meeting-service-integration.md)

### 外部ドキュメント

- [Recall.ai API Documentation](https://docs.recall.ai/reference/)
- [LocalStack Documentation](https://docs.localstack.cloud/)
- [Socket.io Documentation](https://socket.io/docs/)
