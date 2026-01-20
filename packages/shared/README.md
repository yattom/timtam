# @timtam/shared

共有ライブラリ - Lambda/Orchestrator間で共有される型とアダプタ

## 概要

ADR 0014に基づく、会議サービス抽象化レイヤーの実装。
プラットフォーム固有のロジック（Chime SDK、Recall.ai）を統一インターフェースで抽象化する。

## ディレクトリ構造

```
src/
├── types/
│   ├── events.ts          # 統一イベント型（TranscriptEvent等）
│   └── index.ts
├── adapters/
│   ├── MeetingServiceAdapter.ts  # インターフェース定義
│   ├── ChimeAdapter.ts           # Chime SDK実装
│   ├── RecallAdapter.ts          # Recall.ai実装（Phase 2）
│   └── index.ts
└── index.ts
```

## 主要な型

### TranscriptEvent

プラットフォーム非依存の文字起こしイベント。
すべての会議サービス（Chime SDK、Recall.ai）からこの形式に変換される。

```typescript
interface TranscriptEvent {
  meetingId: MeetingId;    // 会議ID
  speakerId: string;       // 発言者ID
  text: string;            // 文字起こしテキスト
  isFinal: boolean;        // 確定フラグ
  timestamp: number;       // エポックミリ秒
  sequenceNumber?: number; // シーケンス番号（オプション）
}
```

## Adapter

### MeetingServiceAdapter インターフェース

2つの責務を持つ：

1. **INBOUND**（Lambda用）: サービス固有形式 → 統一TranscriptEvent
2. **OUTBOUND**（Orchestrator用）: サービス固有エンドポイントへの送信

```typescript
interface MeetingServiceAdapter {
  // INBOUND
  processInboundTranscript(payload: any): TranscriptEvent;

  // OUTBOUND
  postChat(meetingId: MeetingId, message: string): Promise<void>;
  postLlmCallLog(meetingId: MeetingId, prompt: string, rawResponse: string, nodeId?: string): Promise<void>;
}
```

### ChimeAdapter

Chime SDK用の実装。

- **INBOUND**: Chime SDK形式（attendeeId, text, isFinal）→ TranscriptEvent
- **OUTBOUND**: DynamoDBにメッセージ書き込み（ブラウザがポーリング）

```typescript
const adapter = new ChimeAdapter({
  aiMessagesTable: 'timtam-ai-messages',
});

// Lambda側（INBOUND）
const event = adapter.processInboundTranscript({
  meetingId: 'abc123',
  attendeeId: 'attendee-1',
  externalUserId: 'user-1',
  text: 'こんにちは',
  isFinal: true,
});

// Orchestrator側（OUTBOUND）
await adapter.postChat('abc123', 'AI応答メッセージ');
```

### RecallAdapter

Recall.ai用の実装（Phase 2で完全実装予定）。

- **INBOUND**: Recall.ai Webhook形式（bot_id, speaker, words）→ TranscriptEvent
- **OUTBOUND**: Recall.ai Chat API呼び出し

## 使用方法

### Lambda関数（transcriptionEvents.ts）

```typescript
import { ChimeAdapter } from '@timtam/shared';

const adapter = new ChimeAdapter({ aiMessagesTable: AI_MESSAGES_TABLE });

export const handler = async (event) => {
  // Chime形式をTranscriptEventに変換
  const transcriptEvent = adapter.processInboundTranscript({
    meetingId: event.pathParameters.meetingId,
    attendeeId: body.attendeeId,
    externalUserId: body.externalUserId,
    text: body.text,
    isFinal: body.isFinal,
  });

  // SQSに送信
  await sqs.send(new SendMessageCommand({
    QueueUrl: TRANSCRIPT_QUEUE_URL,
    MessageBody: JSON.stringify(transcriptEvent),
  }));
};
```

### Orchestrator（worker.ts）

```typescript
import { ChimeAdapter } from '@timtam/shared';

const notifier = new ChimeAdapter({
  aiMessagesTable: AI_MESSAGES_TABLE,
});

// メッセージ送信
await notifier.postChat(meetingId, 'AI応答メッセージ');

// LLMログ記録
await notifier.postLlmCallLog(meetingId, prompt, response, 'grasp-1');
```

## ビルド

```bash
cd packages/shared
npm install
npm run build
```

ビルド成果物は `dist/` ディレクトリに出力される。

## テスト

```bash
npm test
```

## Phase 1の実装範囲

- [x] 統一イベント型定義（TranscriptEvent）
- [x] MeetingServiceAdapterインターフェース
- [x] ChimeAdapter完全実装
- [x] RecallAdapterスタブ（Phase 2で完全実装）
- [x] 既存Lambda（transcriptionEvents.ts）のリファクタリング
- [x] 既存Orchestrator（worker.ts）のリファクタリング

## Phase 2の予定

- [ ] RecallAdapter完全実装
  - [ ] processInboundTranscript（Recall Webhook → TranscriptEvent）
  - [ ] postChat（Recall Chat API呼び出し）
  - [ ] postLlmCallLog（DynamoDB書き込み）
- [ ] Webhook Lambda実装
- [ ] 会議管理API実装

## 参考

- [ADR 0014: 会議サービス抽象化レイヤー](../../docs/adr/0014-meeting-service-abstraction-layer.md)
- [ADR 0015: 会議ライフサイクル管理とUI設計](../../docs/adr/0015-meeting-lifecycle-and-ui-design.md)
