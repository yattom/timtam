# ADR 0014: Meeting Service Abstraction Layer

- Status: Accepted
- Date: 2026-01-13
- Owners: timtam PoC チーム

## 背景 / Context

現在のシステムはAmazon Chime SDKに深く統合されているが、ADR 0009で決定されたようにサードパーティ会議サービス（Zoom、Google Meet、Microsoft Teamsなど）との統合が必要となった。

**現在のChime SDK統合**:
- ブラウザでChime SDK経由で文字起こしを受信
- トランスクリプトイベントをAPI経由でSQS FIFOに送信
- ECS Orchestratorで処理
- AI応答をDynamoDBに書き込み
- ブラウザでポーリングして表示

**将来の要件**:
- Recall.ai経由でZoom/Meet/Teamsに接続
- ボット形式で会議に参加
- リアルタイム文字起こしを受信
- チャットAPIで応答を送信

### 問題点

1. **密結合**: Orchestrator（`worker.ts`）とChime SDKの実装が密結合
2. **拡張性の欠如**: 新しいプラットフォームを追加するには大幅なコード変更が必要
3. **テスト困難**: プラットフォーム固有のロジックをモック化しにくい

## 決定 / Decision

**Meeting Service Abstraction Layerを段階的に導入する**

Phase 1では、メッセージ送信部分のみを抽象化し、既存のChime SDK実装への影響を最小化する。Phase 2以降で全体的な抽象化を進める。

### Phase 1: Notifierの抽象化（本ADR）

既存の`Notifier`インターフェース（`grasp.ts`）を活用し、プラットフォーム固有の実装を分離する。

```typescript
// 既存インターフェース（grasp.ts:43-46）
export interface Notifier {
  postChat(meetingId: MeetingId, message: string): Promise<void>;
  postLlmCallLog(meetingId: MeetingId, prompt: string, rawResponse: string, nodeId?: string): Promise<void>;
}
```

**実装クラス**:
1. `ChimeNotifier` - Chime SDK用（DynamoDB経由）
2. `RecallNotifier` - Recall.ai用（Chat API経由、Phase 2実装）

### Phase 2: 全体的な抽象化（将来）

```typescript
export interface MeetingServiceAdapter {
  onTranscript(callback: (event: TranscriptEvent) => void): void;
  sendMessage(meetingId: string, text: string): Promise<void>;
  sendAudio?(meetingId: string, audioData: Buffer): Promise<void>;
  join(meetingInfo: MeetingInfo): Promise<void>;
  leave(meetingId: string): Promise<void>;
  onParticipantEvent?(callback: (event: ParticipantEvent) => void): void;
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
}
```

## アーキテクチャ / Architecture

### Phase 1: ディレクトリ構造

```
services/orchestrator/
├── src/
│   └── adapters/
│       ├── index.ts                       # エクスポート
│       ├── ChimeNotifier.ts               # Chime SDK実装
│       ├── RecallNotifier.ts              # Recall.ai実装（スタブ）
│       ├── MessageNotifier.ts             # 再エクスポート
│       ├── MeetingServiceAdapter.ts       # Phase 2インターフェース
│       ├── ChimeSDKAdapter.ts             # Phase 2実装（スタブ）
│       ├── RecallAIAdapter.ts             # Phase 2実装（スタブ）
│       └── AdapterFactory.ts              # ファクトリー
├── worker.ts
└── grasp.ts
```

### Phase 1: データフロー（変更なし）

```
Browser (Chime SDK)
  ↓ TranscriptEvent
API Gateway → Lambda
  ↓ SendMessage
SQS FIFO Queue
  ↓ Long polling
ECS Orchestrator (worker.ts)
  ↓ processAsrEvent
Meeting Orchestrator
  ↓ Grasp処理
ChimeNotifier.postChat() ← 新しい抽象化層
  ↓ PutCommand
DynamoDB (ai-messages)
  ↓ polling
Browser表示
```

### Phase 1: コード変更

**Before** (`worker.ts:103-186`):
```typescript
class Notifier implements INotifier {
  private ddb: DynamoDBDocumentClient;

  constructor() {
    const ddbClient = new DynamoDBClient({});
    this.ddb = DynamoDBDocumentClient.from(ddbClient);
  }

  async postChat(meetingId: MeetingId, message: string) {
    // DynamoDB PutCommand実装
  }
}

const notifier = new Notifier();
```

**After**:
```typescript
import { ChimeNotifier } from './src/adapters';

const notifier = new ChimeNotifier(AI_MESSAGES_TABLE);
```

**新規ファイル** (`src/adapters/ChimeNotifier.ts`):
```typescript
import { Notifier, MeetingId } from '../../grasp';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

export class ChimeNotifier implements Notifier {
  private ddb: DynamoDBDocumentClient;
  private aiMessagesTable: string;

  constructor(aiMessagesTable: string) {
    const ddbClient = new DynamoDBClient({});
    this.ddb = DynamoDBDocumentClient.from(ddbClient);
    this.aiMessagesTable = aiMessagesTable;
  }

  async postChat(meetingId: MeetingId, message: string): Promise<void> {
    // 既存のDynamoDB PutCommand実装
  }

  async postLlmCallLog(...): Promise<void> {
    // 既存のLLMログ実装
  }
}
```

**Phase 2用スタブ** (`src/adapters/RecallNotifier.ts`):
```typescript
export class RecallNotifier implements Notifier {
  async postChat(meetingId: MeetingId, message: string): Promise<void> {
    // TODO Phase 2: Recall.ai Chat API実装
    // POST /api/v1/bot/{botId}/send_chat_message/
    throw new Error('RecallNotifier.postChat not yet implemented (Phase 2)');
  }
}
```

## 影響 / Consequences

### ポジティブ

1. **疎結合化**: プラットフォーム固有のロジックが分離される
2. **拡張性**: 新しいプラットフォームを追加しやすい
3. **テスタビリティ**: モック実装を簡単に作成できる
4. **段階的移行**: Phase 1は既存実装に影響を与えない
5. **保守性向上**: プラットフォーム固有のコードが独立したファイルに整理される

### ネガティブ

1. **複雑度の増加**: 抽象化レイヤーが追加される（ただし最小限）
2. **リファクタリングコスト**: 既存コードを段階的に移行する必要がある
3. **Phase 1の制限**: トランスクリプト受信部分は未抽象化（Phase 2対応）

### リスク軽減策

**Phase 1の制限への対応**:
- SQSポーリングロジックは`worker.ts`に残す
- Phase 2で全体的な抽象化を行う際に、Webhook経由の受信も統合

**既存機能への影響**:
- `ChimeNotifier`は既存の`Notifier`クラスと完全互換
- 環境変数`MEETING_PLATFORM=chime`（デフォルト）で動作選択
- テストで両実装の互換性を確認

## 代替案 / Alternatives Considered

### 代替案A: 全体を一度にリファクタリング

**概要**: Phase 1とPhase 2を同時に実装

**メリット**:
- 一度の変更で完全な抽象化を実現
- 段階的移行のオーバーヘッドがない

**デメリット**:
- ❌ リスクが高い（大規模な変更）
- ❌ Recall.ai統合が未検証の状態で設計が困難
- ❌ 既存機能への影響が大きい

**却下理由**: 段階的アプローチの方が安全

### 代替案B: Recall.ai専用の別システムを構築

**概要**: Chime SDK用とRecall.ai用を完全に分離

**メリット**:
- 既存システムへの影響ゼロ
- 独立した開発が可能

**デメリット**:
- ❌ コードの重複
- ❌ Graspロジックの二重管理
- ❌ 運用コストが2倍

**却下理由**: ADR 0009で統合アーキテクチャが選択済み

### 代替案C: 抽象化なしで直接統合

**概要**: `worker.ts`にif文でプラットフォーム判定

**メリット**:
- 実装が最も単純
- 抽象化のオーバーヘッドなし

**デメリット**:
- ❌ コードの可読性低下
- ❌ テストが困難
- ❌ 将来的な拡張性がない

**却下理由**: 保守性が悪い

## 実装計画 / Implementation Plan

### Phase 1: Notifierの抽象化

1. ✅ `src/adapters/`ディレクトリ作成
2. ✅ `ChimeNotifier`実装
3. ✅ `RecallNotifier`スタブ作成
4. ✅ Phase 2用インターフェース定義（準備）
5. ⬜ `worker.ts`をリファクタリング
6. ⬜ 単体テスト作成
7. ⬜ 統合テスト（既存フロー確認）

### Phase 2: Recall.ai統合（別Issue）

1. Recall.ai APIクライアント実装
2. Webhookサーバー作成
3. `RecallAIAdapter`完全実装
4. `RecallNotifier`完全実装
5. `worker.ts`をアダプタパターンに完全移行

### Phase 3: WebUI拡張（別Issue）

1. Recall.ai用WebUI実装
2. 会議URL入力フォーム
3. リアルタイム文字起こし表示

## 未決事項 / TBD

1. **環境変数命名**: `MEETING_PLATFORM` vs `NOTIFIER_TYPE`
2. **DynamoDB vs チャット**: Recall.aiでもDynamoDBに保存するか、直接チャットのみか
3. **マルチプラットフォーム同時運用**: 同じOrchestratorで両方のプラットフォームを処理するか
4. **Phase 2実装時期**: Issue #45のスコープ内か、別Issueか

## 参考 / References

### 関連ADR
- ADR 0009: サードパーティ会議サービス統合アーキテクチャ
- ADR 0011: SQS FIFO移行
- ADR 0007: Orchestratorとブラウザの連携

### 関連ファイル
- `services/orchestrator/worker.ts:103-186` - 既存Notifier実装
- `services/orchestrator/grasp.ts:43-46` - Notifierインターフェース
- `services/orchestrator/src/adapters/` - 新しい抽象化レイヤー

### Recall.ai ドキュメント
- [Getting Started](https://docs.recall.ai/docs/getting-started)
- [Sending Chat Messages](https://docs.recall.ai/docs/sending-chat-messages)
- [Bot Real-time Transcription](https://docs.recall.ai/docs/bot-real-time-transcription)
