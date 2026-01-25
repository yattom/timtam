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

### Recall.ai Stub Server 設計

#### 1. Mock API エンドポイント

```typescript
// stub-recall-server/src/api.ts

/**
 * POST /api/v1/bot/
 * ボット作成（会議参加）
 */
app.post('/api/v1/bot/', (req, res) => {
  const { meeting_url, bot_name, recording_config } = req.body;

  // localhost URLの場合のみ受け付ける
  if (!meeting_url.includes('localhost')) {
    return res.status(400).json({ error: 'Only localhost meetings are supported in stub mode' });
  }

  const bot = {
    id: `bot_${Date.now()}`,
    meeting_url,
    bot_name: bot_name || 'Timtam AI (Stub)',
    status: 'in_meeting',
    status_message: 'Stub bot is ready',
    created_at: new Date().toISOString(),
  };

  // メモリに保存
  bots.set(bot.id, bot);

  res.json(bot);
});

/**
 * GET /api/v1/bot/{bot_id}/
 * ボット情報取得
 */
app.get('/api/v1/bot/:bot_id/', (req, res) => {
  const bot = bots.get(req.params.bot_id);
  if (!bot) {
    return res.status(404).json({ error: 'Bot not found' });
  }
  res.json(bot);
});

/**
 * POST /api/v1/bot/{bot_id}/send_chat_message/
 * チャットメッセージ送信
 */
app.post('/api/v1/bot/:bot_id/send_chat_message/', (req, res) => {
  const bot = bots.get(req.params.bot_id);
  if (!bot) {
    return res.status(404).json({ error: 'Bot not found' });
  }

  const { message } = req.body;

  // メッセージをUI用のストレージに保存
  if (!chatMessages.has(bot.id)) {
    chatMessages.set(bot.id, []);
  }
  chatMessages.get(bot.id)!.push({
    timestamp: new Date().toISOString(),
    message,
    sender: 'AI',
  });

  // WebSocketでUIに通知（リアルタイム更新）
  io.emit('chat_message', { bot_id: bot.id, message });

  res.json({ ok: true });
});

/**
 * POST /api/v1/bot/{bot_id}/leave_call/
 * ボット退出
 */
app.post('/api/v1/bot/:bot_id/leave_call/', (req, res) => {
  const bot = bots.get(req.params.bot_id);
  if (!bot) {
    return res.status(404).json({ error: 'Bot not found' });
  }

  bot.status = 'done';
  bot.status_message = 'Bot left the meeting';

  res.json({ ok: true });
});
```

#### 2. Web UI（文字起こし入力フォーム）

```html
<!-- stub-recall-server/public/index.html -->

<!DOCTYPE html>
<html>
<head>
  <title>Recall.ai Stub Server - Timtam Local Dev</title>
  <meta charset="UTF-8">
  <style>
    body { font-family: sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
    .container { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .panel { border: 1px solid #ccc; border-radius: 8px; padding: 20px; }
    h2 { margin-top: 0; }
    input, textarea, select { width: 100%; padding: 8px; margin-bottom: 10px; box-sizing: border-box; }
    button { padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; }
    button:hover { background: #0056b3; }
    .chat-log { height: 300px; overflow-y: auto; border: 1px solid #eee; padding: 10px; background: #f9f9f9; margin-bottom: 10px; }
    .chat-message { margin-bottom: 8px; padding: 8px; border-radius: 4px; }
    .chat-message.user { background: #e3f2fd; }
    .chat-message.ai { background: #fff3e0; }
    .bot-list { list-style: none; padding: 0; }
    .bot-item { padding: 10px; border: 1px solid #eee; margin-bottom: 5px; border-radius: 4px; cursor: pointer; }
    .bot-item.active { background: #e3f2fd; }
    .bot-status { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.8em; }
    .bot-status.in_meeting { background: #4caf50; color: white; }
    .bot-status.done { background: #9e9e9e; color: white; }
  </style>
</head>
<body>
  <h1>🤖 Recall.ai Stub Server - Timtam Local Dev</h1>

  <div class="container">
    <!-- 左パネル: ボット一覧 -->
    <div class="panel">
      <h2>Active Bots</h2>
      <ul id="bot-list" class="bot-list">
        <li style="color: #999;">ボットがありません</li>
      </ul>
    </div>

    <!-- 右パネル: 文字起こし送信 -->
    <div class="panel">
      <h2>Send Transcript</h2>

      <label>Bot ID:</label>
      <select id="bot-select">
        <option value="">-- ボットを選択 --</option>
      </select>

      <label>話者名:</label>
      <input type="text" id="speaker-name" placeholder="例: 田中太郎" value="田中太郎">

      <label>文字起こしテキスト:</label>
      <textarea id="transcript-text" rows="4" placeholder="例: 今日の会議の目的は..."></textarea>

      <button onclick="sendTranscript()">📤 Webhookに送信</button>

      <h3>Chat Log (AI Responses)</h3>
      <div id="chat-log" class="chat-log"></div>
    </div>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    let selectedBotId = null;

    // ボット一覧を更新
    async function updateBotList() {
      const res = await fetch('/api/v1/bot/');
      const bots = await res.json();

      const botList = document.getElementById('bot-list');
      const botSelect = document.getElementById('bot-select');

      if (bots.results.length === 0) {
        botList.innerHTML = '<li style="color: #999;">ボットがありません</li>';
        botSelect.innerHTML = '<option value="">-- ボットを選択 --</option>';
        return;
      }

      botList.innerHTML = bots.results.map(bot => `
        <li class="bot-item ${bot.id === selectedBotId ? 'active' : ''}" onclick="selectBot('${bot.id}')">
          <strong>${bot.bot_name}</strong>
          <span class="bot-status ${bot.status}">${bot.status}</span><br>
          <small>${bot.id}</small>
        </li>
      `).join('');

      botSelect.innerHTML = '<option value="">-- ボットを選択 --</option>' +
        bots.results.map(bot => `<option value="${bot.id}">${bot.bot_name} (${bot.id})</option>`).join('');
    }

    // ボット選択
    function selectBot(botId) {
      selectedBotId = botId;
      document.getElementById('bot-select').value = botId;
      updateBotList();
      loadChatLog(botId);
    }

    // チャットログを読み込み
    async function loadChatLog(botId) {
      const res = await fetch(`/api/chat/${botId}`);
      const messages = await res.json();

      const chatLog = document.getElementById('chat-log');
      chatLog.innerHTML = messages.map(msg => `
        <div class="chat-message ${msg.sender.toLowerCase()}">
          <strong>${msg.sender}:</strong> ${msg.message}
          <br><small>${new Date(msg.timestamp).toLocaleTimeString()}</small>
        </div>
      `).join('');

      chatLog.scrollTop = chatLog.scrollHeight;
    }

    // 文字起こしを送信
    async function sendTranscript() {
      const botId = document.getElementById('bot-select').value;
      const speakerName = document.getElementById('speaker-name').value;
      const text = document.getElementById('transcript-text').value;

      if (!botId) {
        alert('ボットを選択してください');
        return;
      }

      if (!text) {
        alert('テキストを入力してください');
        return;
      }

      // Recall.ai Webhook形式のペイロードを構築
      const payload = {
        event: 'transcript.data',
        data: {
          bot: { id: botId, metadata: {} },
          data: {
            words: text.split('').map((char, i) => ({
              text: char,
              start_timestamp: { relative: i * 100, absolute: new Date().toISOString() },
              end_timestamp: { relative: (i + 1) * 100, absolute: new Date().toISOString() }
            })),
            participant: { id: Math.floor(Math.random() * 1000), name: speakerName, is_host: false, platform: 'stub' }
          },
          transcript: { id: `transcript_${Date.now()}`, metadata: {} },
          realtime_endpoint: { id: 'endpoint_1', metadata: {} },
          recording: { id: 'recording_1', metadata: {} }
        }
      };

      // ローカルのWebhookエンドポイントに送信
      const res = await fetch('http://localhost:3000/recall/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        // 送信成功 - チャットログに追加
        const chatLog = document.getElementById('chat-log');
        const newMsg = document.createElement('div');
        newMsg.className = 'chat-message user';
        newMsg.innerHTML = `<strong>${speakerName}:</strong> ${text}<br><small>${new Date().toLocaleTimeString()}</small>`;
        chatLog.appendChild(newMsg);
        chatLog.scrollTop = chatLog.scrollHeight;

        // フォームをクリア
        document.getElementById('transcript-text').value = '';
      } else {
        alert('送信に失敗しました');
      }
    }

    // WebSocketでリアルタイム更新
    socket.on('chat_message', (data) => {
      if (data.bot_id === selectedBotId) {
        loadChatLog(data.bot_id);
      }
    });

    socket.on('bot_created', updateBotList);
    socket.on('bot_updated', updateBotList);

    // 初期化
    updateBotList();
    setInterval(updateBotList, 5000); // 5秒ごとに更新
  </script>
</body>
</html>
```

#### 3. 特殊なミーティングURL処理

Facilitator UIで会議を作成する際、ミーティングURLとして`localhost`を指定すると、Stub Serverに接続する:

```typescript
// services/meeting-api/recallMeetings.ts

export const joinHandler: APIGatewayProxyHandlerV2 = async (event) => {
  // ... バリデーション ...

  const { meetingUrl, platform, botName, graspConfigId } = parsedBody;

  // ローカル開発環境の検出
  const isLocalDev = meetingUrl.includes('localhost') || meetingUrl.includes('127.0.0.1');

  // RecallAPIClientの初期化
  const recallClient = new RecallAPIClient({
    apiKey: RECALL_API_KEY,
    apiBaseUrl: isLocalDev
      ? 'http://localhost:8080'  // Stub Server
      : 'https://us-west-2.recall.ai', // 本番
  });

  // ... ボット作成 ...
};
```

### docker-compose.yml

```yaml
version: '3.8'

services:
  # LocalStack (DynamoDB、SQS、S3)
  localstack:
    image: localstack/localstack:latest
    ports:
      - "4566:4566"
    environment:
      - SERVICES=dynamodb,sqs,s3
      - DEBUG=1
      - DATA_DIR=/var/lib/localstack/data
    volumes:
      - "./localstack-data:/var/lib/localstack/data"
    networks:
      - timtam-local

  # Recall.ai Stub Server
  recall-stub:
    build: ./stub-recall-server
    ports:
      - "8080:8080"
    environment:
      - WEBHOOK_URL=http://api-server:3000/recall/webhook
    networks:
      - timtam-local

  # Express API Server
  api-server:
    build: ./local-api-server
    ports:
      - "3000:3000"
    environment:
      - AWS_ENDPOINT_URL=http://localstack:4566
      - RECALL_API_BASE_URL=http://recall-stub:8080
      - AI_MESSAGES_TABLE=timtam-ai-messages
      - MEETINGS_METADATA_TABLE=timtam-meetings-metadata
      - TRANSCRIPT_QUEUE_URL=http://localstack:4566/000000000000/transcript-asr.fifo
    depends_on:
      - localstack
      - recall-stub
    networks:
      - timtam-local

  # ECS Orchestrator
  orchestrator:
    build: ./services/orchestrator
    environment:
      - AWS_ENDPOINT_URL=http://localstack:4566
      - RECALL_API_BASE_URL=http://recall-stub:8080
      - TRANSCRIPT_QUEUE_URL=http://localstack:4566/000000000000/transcript-asr.fifo
      - AI_MESSAGES_TABLE=timtam-ai-messages
      - CONFIG_TABLE_NAME=timtam-orchestrator-config
      - MEETINGS_METADATA_TABLE=timtam-meetings-metadata
      - BEDROCK_REGION=ap-northeast-1
      - BEDROCK_MODEL_ID=arn:aws:bedrock:ap-northeast-1:030046728177:inference-profile/global.anthropic.claude-haiku-4-5-20251001-v1:0
      - BEDROCK_MOCK_MODE=false  # trueにするとBedrockもモック化
      - WINDOW_LINES=5
      - POLL_INTERVAL_MS=1000
    volumes:
      - "~/.aws:/root/.aws:ro"  # Bedrock用（MOCK_MODE=falseの場合）
    depends_on:
      - localstack
      - recall-stub
    networks:
      - timtam-local

networks:
  timtam-local:
    driver: bridge
```

### 開発フロー

```bash
# 1. LocalStack + Stub + API Server + Orchestrator起動
docker-compose up

# 2. 初回のみ: LocalStackにリソース作成
./scripts/setup-localstack.sh

# 3. Webフロントエンド起動
cd web/facilitator
pnpm dev

# 4. ブラウザで開く
# - Facilitator UI: http://localhost:5173
# - Stub Server UI: http://localhost:8080
```

### 使い方

1. **Facilitator UI**で会議を作成
   - ミーティングURL: `localhost`
   - プラットフォーム: `zoom`（任意）
   - ボット名: `Timtam AI (Local)`

2. **Stub Server UI** (http://localhost:8080) を開く
   - 作成されたボットが一覧に表示される

3. **文字起こしを送信**
   - ボットを選択
   - 話者名を入力（例: `田中太郎`）
   - テキストを入力（例: `今日の会議の目的は...`）
   - 「📤 Webhookに送信」ボタンをクリック

4. **AI応答を確認**
   - Stub Server UIのChat Logに表示される
   - Orchestratorが判断し、RecallAdapter経由でChat APIに送信
   - Stub ServerがWebSocketでUIに通知

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

### リスク軽減策

1. **本番環境との差異リスク**
   - CI/CDでAWS環境での統合テストを実施
   - Stub Serverのログに「STUB MODE」を明記

2. **Recall.ai API変更への追従**
   - Stub Serverは最小限のエンドポイントのみ実装
   - 公式ドキュメントとのリンクをコメントに記載

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

### Phase 2: docker-compose.yml更新（1時間）

1. `recall-stub` サービス追加
2. 環境変数設定（`RECALL_API_BASE_URL`）
3. ネットワーク設定

### Phase 3: 既存コード修正（1時間）

1. `RecallAPIClient` で `apiBaseUrl` をサポート
2. `recallMeetings.ts` で `localhost` URL判定
3. 環境変数追加（`.env.local.example`）

### Phase 4: テスト＆ドキュメント（2時間）

1. E2Eテスト（会議作成→文字起こし→AI応答）
2. `docs/local-development.md` 作成
3. トラブルシューティングガイド

### 総所要時間: 8-10時間

## 代替案 / Alternatives Considered

### 代替案A: ngrokで本番Recall.aiに接続

**概要**: ngrokでローカルWebhookエンドポイントを公開し、本番Recall.aiから受信

**却下理由**:
- ❌ インターネット接続必須
- ❌ Recall.ai課金が発生
- ❌ 実際の会議が必要
- ❌ オフライン開発不可

### 代替案B: Recall.ai APIを完全にモック化（UI なし）

**概要**: Stub ServerをAPIのみにし、UIは作らない

**却下理由**:
- ❌ 文字起こしテストにcURLコマンドが必要（開発者体験が悪い）
- ❌ AI応答の確認が困難（DynamoDBを直接クエリ）
- ❌ デバッグ効率が低い

### 代替案C: AWS SAM Localを使用

**概要**: AWS SAM CLIでLambda/API Gatewayをローカル実行

**却下理由**:
- ❌ SAMテンプレート作成が必要（現在はCDK使用）
- ❌ Recall.ai Stubは別途必要
- ❌ 学習コスト

## 未決事項 / TBD

1. **Bedrockモックモードの実装範囲**
   - 固定レスポンス？ランダム？ルールベース？
   - 実装優先度は低い（本番Bedrockで開発可能）

2. **LocalStackデータの永続化方針**
   - Dockerボリューム vs git管理
   - seedデータの準備

3. **Stub Server UIの多言語対応**
   - 現在は日本語のみ
   - 英語対応の要否

## 参考 / References

### 関連ADR

- [ADR 0012: ローカル開発環境（ハイブリッドアプローチ）](./0012-local-development-environment.md)
- [ADR 0014: 会議サービス抽象化レイヤー](./0014-meeting-service-abstraction-layer.md)
- [ADR 0009: サードパーティ会議サービス統合](./0009-third-party-meeting-service-integration.md)

### 関連ファイル

- `services/meeting-api/recallMeetings.ts` - Recall.ai API呼び出し
- `services/meeting-api/recallWebhook.ts` - Webhook受信
- `packages/shared/src/recall/RecallAPIClient.ts` - Recall.ai APIクライアント
- `packages/shared/src/adapters/RecallAdapter.ts` - RecallAdapter実装

### 外部ドキュメント

- [Recall.ai API Documentation](https://docs.recall.ai/reference/)
- [LocalStack Documentation](https://docs.localstack.cloud/)
- [Socket.io Documentation](https://socket.io/docs/)
