# マルチプロンプトオーケストレーション

複数のLLMプロンプトを連携させて、動的なファシリテーション機能を実現するシステム。

## 概要

従来の単一プロンプトによる介入判断から、複数のプロンプトを組み合わせることで、より複雑で柔軟なLLM活用が可能になる。

### 主な機能

1. **複数プロンプトの定義と実行**
   - 各プロンプトに独立したトリガー条件を設定
   - プロンプト間で状態（メモ、カウンター）を共有

2. **柔軟なトリガー条件**
   - `every`: 毎回実行
   - `interval`: 定期実行（ミリ秒単位）
   - `threshold`: カウンター閾値で実行
   - `dependency`: 他プロンプトの実行後に実行

3. **状態管理**
   - `stateful: true`のプロンプトはメモを保持
   - カウンターで特定の発言や状況を追跡
   - プロンプトごとの実行回数、最終実行時刻を記録

4. **出力先の制御**
   - `intervention`: 参加者への介入メッセージ
   - `memo`: 内部メモのみ（他プロンプトが参照可能）
   - `both`: 両方に出力

## アーキテクチャ

### コンポーネント

```
┌─────────────────────────────────────────────┐
│  Kinesis Stream (文字起こしイベント)          │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────┐
│  MultiPromptWorker                            │
│  - イベント受信                               │
│  - ウィンドウバッファ管理                      │
│  - MultiPromptEngine呼び出し                  │
└──────────────┬───────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────┐
│  MultiPromptEngine                            │
│  - プロンプト評価                             │
│  - トリガー条件チェック                        │
│  - LLM呼び出し                                │
│  - 状態管理                                   │
└──────────────┬───────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────┐
│  DynamoDB                                     │
│  - 介入メッセージ保存                          │
│  - プロンプト状態保存                          │
│  - 設定保存                                   │
└──────────────────────────────────────────────┘
```

### ファイル構成

- `services/orchestrator/multi-prompt-types.ts`: 型定義
- `services/orchestrator/multi-prompt-engine.ts`: エンジン本体
- `services/orchestrator/multi-prompt-worker.ts`: ワーカープロセス
- `services/orchestrator-config/getMultiPromptConfig.ts`: 設定取得API
- `services/orchestrator-config/updateMultiPromptConfig.ts`: 設定更新API
- `services/orchestrator-config/getPromptStates.ts`: 状態取得API
- `web/timtam-web/src/MultiPromptConfig.tsx`: Web UI

## 設定例

### 基本設定

```json
{
  "version": "1.0",
  "prompts": [
    {
      "id": "observer",
      "name": "会話観察者",
      "promptText": "会話を観察して重要なポイントをメモに記録してください",
      "trigger": { "type": "every" },
      "stateful": true,
      "outputTo": "memo"
    },
    {
      "id": "commentator",
      "name": "全体コメンテーター",
      "promptText": "これまでのメモを参照して、会議の全体的な流れについてコメントしてください",
      "trigger": { "type": "interval", "intervalMs": 30000 },
      "stateful": false,
      "outputTo": "intervention"
    }
  ],
  "globalSettings": {
    "windowLines": 5,
    "defaultCooldownMs": 5000
  }
}
```

### ユースケース別の設定例

#### 1. 観察とコメントの分離

```json
{
  "prompts": [
    {
      "id": "observer",
      "name": "観察者",
      "promptText": "会話を観察してメモを記録する",
      "trigger": { "type": "every" },
      "stateful": true,
      "outputTo": "memo"
    },
    {
      "id": "flow-commentator",
      "name": "流れコメンテーター",
      "promptText": "メモを使って会議の流れについてコメント",
      "trigger": { "type": "interval", "intervalMs": 60000 },
      "stateful": false,
      "outputTo": "intervention"
    }
  ]
}
```

#### 2. 介入判断の二段階処理

```json
{
  "prompts": [
    {
      "id": "detector",
      "name": "問題検出",
      "promptText": "介入が必要な状況を検出し、カウンターを更新",
      "trigger": { "type": "every" },
      "stateful": true,
      "outputTo": "memo"
    },
    {
      "id": "responder",
      "name": "応答生成",
      "promptText": "検出された問題に対して適切な言い回しを生成",
      "trigger": { "type": "threshold", "counter": "issues", "value": 3 },
      "stateful": false,
      "outputTo": "intervention"
    }
  ]
}
```

#### 3. 特定の発言カウント

```json
{
  "prompts": [
    {
      "id": "question-counter",
      "name": "質問カウンター",
      "promptText": "質問形式の発言を検出し、カウントする",
      "trigger": { "type": "every" },
      "stateful": true,
      "outputTo": "memo"
    },
    {
      "id": "question-reminder",
      "name": "質問リマインダー",
      "promptText": "未回答の質問が3つ以上ある場合、リマインドする",
      "trigger": { "type": "threshold", "counter": "unanswered_questions", "value": 3 },
      "stateful": false,
      "outputTo": "intervention"
    }
  ]
}
```

## LLMレスポンス形式

各プロンプトは以下の形式でJSONレスポンスを返す必要がある:

### 介入メッセージの場合

```json
{
  "should_intervene": true,
  "reason": "会話が抽象的すぎる",
  "message": "もう少し具体的な例を挙げてもらえますか？"
}
```

### メモのみの場合

```json
{
  "memo": "議論のポイント: 1) 予算の制約 2) スケジュールの調整 3) リソースの配分"
}
```

### カウンター更新の場合

```json
{
  "memo": "質問を検出しました",
  "counters": {
    "unanswered_questions": 2
  }
}
```

## Web UI

Web UIでは以下の機能を提供:

1. **設定エディタ**
   - JSON形式での設定編集
   - リアルタイム保存
   - バリデーション

2. **状態モニタリング**
   - 各プロンプトの実行状態表示
   - メモの内容表示
   - カウンターの値表示
   - 実行回数と最終実行時刻

3. **リアルタイム更新**
   - 3秒ごとに自動更新
   - 会議中の状態変化を追跡

## 環境変数

マルチプロンプトワーカーで使用する環境変数:

- `MULTI_PROMPT_CONFIG_TABLE`: 設定テーブル名（デフォルト: `timtam-multi-prompt-config`）
- `PROMPT_STATES_TABLE`: 状態テーブル名（デフォルト: `timtam-prompt-states`）
- `KINESIS_STREAM_NAME`: Kinesisストリーム名
- `BEDROCK_REGION`: Bedrockリージョン
- `BEDROCK_MODEL_ID`: 使用するモデルID
- `CONTROL_SQS_URL`: コントロールSQSのURL

## DynamoDBテーブル

### 設定テーブル (`timtam-multi-prompt-config`)

```
PK: configKey (String) - "current_config"
Attributes:
  - config (Map): OrchestratorConfig
  - updatedAt (Number): 更新タイムスタンプ
```

### 状態テーブル (`timtam-prompt-states`)

```
PK: meetingId (String)
SK: timestamp (Number)
Attributes:
  - states (Map): プロンプトIDごとの状態
  - ttl (Number): 24時間後に自動削除
```

## API エンドポイント

### GET /orchestrator/multi-prompt-config

マルチプロンプト設定を取得

レスポンス:
```json
{
  "config": { ... },
  "updatedAt": 1234567890
}
```

### PUT /orchestrator/multi-prompt-config

マルチプロンプト設定を更新

リクエスト:
```json
{
  "config": { ... }
}
```

### GET /orchestrator/prompt-states/{meetingId}

会議のプロンプト状態を取得

レスポンス:
```json
{
  "meetingId": "abc-123",
  "states": {
    "observer": {
      "promptId": "observer",
      "memo": "...",
      "lastExecutedAt": 1234567890,
      "executionCount": 5,
      "counters": {}
    }
  },
  "timestamp": 1234567890
}
```

## 今後の拡張

1. **プロンプトテンプレート**
   - よく使うパターンをテンプレート化
   - UI上で簡単に適用

2. **ビジュアルエディタ**
   - プロンプトフローの可視化
   - ドラッグ&ドロップでの設定

3. **メトリクス強化**
   - プロンプトごとのレイテンシ
   - 成功率の追跡
   - コスト分析

4. **A/Bテスト機能**
   - 複数設定の並行実行
   - 効果測定
