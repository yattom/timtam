# Recall.ai Stub Server

Recall.aiのAPIをモックするローカル開発用スタブサーバー。

## 概要

このサーバーは以下の機能を提供する:

1. **Mock Recall.ai API**: 主要なRecall.ai APIエンドポイントをモック
2. **Web UI**: ブラウザから文字起こしを手動で送信できるインターフェース
3. **WebSocket**: リアルタイムでAI応答を表示

## 起動方法

### 単体で起動

```bash
cd stub-recall-server
npm install
npm start
```

ブラウザで http://localhost:8080 を開く。

### Docker Composeで起動（推奨）

```bash
# プロジェクトルートで
docker-compose up
```

## 使い方

1. Facilitator UIで会議を作成
   - ミーティングURL: `localhost`
   - ボット名: 任意

2. Stub Server UI (http://localhost:8080) を開く

3. 作成されたボットを選択

4. 文字起こしを入力して送信
   - 話者名: 例 `田中太郎`
   - テキスト: 例 `今日の会議の目的は...`

5. AI応答がChat Logに表示される

## API エンドポイント

### Recall.ai互換エンドポイント

- `POST /api/v1/bot/` - ボット作成
- `GET /api/v1/bot/:bot_id/` - ボット情報取得
- `POST /api/v1/bot/:bot_id/send_chat_message/` - チャットメッセージ送信
- `POST /api/v1/bot/:bot_id/leave_call/` - ボット退出

### Stub専用エンドポイント

- `GET /api/chat/:bot_id` - チャットログ取得
- `POST /api/send-transcript` - 文字起こし送信（UI用）
- `GET /health` - ヘルスチェック

## 環境変数

- `PORT` - サーバーポート（デフォルト: 8080）
- `WEBHOOK_URL` - Webhookの送信先URL（デフォルト: http://localhost:3000/recall/webhook）

## 参考

- [Recall.ai API Documentation](https://docs.recall.ai/reference/)
- [ADR 0016](../docs/adr/0016-local-development-environment-recall-stub.md)
