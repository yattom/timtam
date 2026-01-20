# 複数ミーティング対応オーケストレーターのアーキテクチャ

## 概要

このドキュメントは、timtamのオーケストレーターを単一ミーティング対応から複数ミーティングの並行処理に対応させるために行った設計変更について説明します。

## 変更の背景

### 以前の実装の課題

以前のオーケストレーターは以下の制約がありました：

1. **単一ミーティングのみ対応**: グローバル変数として`CURRENT_MEETING_ID`、`WindowBuffer`、`NotesStore`、`GraspQueue`を管理しており、1つのミーティングしか処理できませんでした
2. **状態の共有**: 複数のミーティングが存在する場合、状態が混在し、互いに干渉する可能性がありました
3. **スケーラビリティの欠如**: 同時に複数のミーティングを処理するための仕組みがありませんでした

## 新しいアーキテクチャ

### 主要なコンポーネント

#### 1. MeetingOrchestrator

各ミーティング専用のオーケストレーターインスタンスです。

**責務:**
- 単一のミーティングの状態を管理
- ミーティング固有の`WindowBuffer`、`Notebook`、`GraspQueue`を保持
- ASRイベントの処理
- Graspキューの管理

**主要なメソッド:**
```typescript
class MeetingOrchestrator {
  constructor(config: MeetingOrchestratorConfig, grasps: Grasp[])
  async processTranscriptEvent(ev: TranscriptEvent, notifier: Notifier, metrics: Metrics): Promise<void>
  async processQueuePeriodically(notifier: Notifier, metrics: Metrics): Promise<boolean>
  rebuildGrasps(grasps: Grasp[]): void
  cleanup(): void
}
```

**状態の分離:**
- 各`MeetingOrchestrator`インスタンスは独立した状態を持ちます
- ミーティング間で状態が共有されることはありません
- 1つのミーティングの処理が他のミーティングに影響を与えません

#### 2. OrchestratorManager

複数の`MeetingOrchestrator`を管理するマネージャークラスです。

**責務:**
- `MeetingOrchestrator`インスタンスのライフサイクル管理
- ミーティングIDに基づいた適切なオーケストレーターへの振り分け
- リソース管理（最大ミーティング数、非アクティブミーティングのクリーンアップ）
- すべてのミーティングのキュー処理

**主要なメソッド:**
```typescript
class OrchestratorManager {
  constructor(graspsTemplate: Grasp[], config?: OrchestratorManagerConfig)
  getOrCreateOrchestrator(meetingId: string): MeetingOrchestrator
  async processTranscriptEvent(ev: TranscriptEvent, notifier: Notifier, metrics: Metrics): Promise<void>
  async processAllQueues(notifier: Notifier, metrics: Metrics): Promise<number>
  cleanupInactiveMeetings(): number
  removeMeeting(meetingId: string): boolean
  rebuildAllGrasps(grasps: Grasp[]): void
  getStatus(): {...}
}
```

**リソース管理:**
- `maxMeetings`: 同時に処理できる最大ミーティング数（デフォルト: 100）
- `meetingTimeoutMs`: ミーティングの非アクティブタイムアウト（デフォルト: 1時間）
- 最大数に達した場合、非アクティブなミーティングを自動的にクリーンアップします

### データフロー

```
ASRイベント (SQS)
    ↓
worker.ts (processMessages)
    ↓
OrchestratorManager.processTranscriptEvent()
    ↓
MeetingOrchestrator.processTranscriptEvent()
    ↓
- WindowBuffer に追加
- Graspキューに追加
- Graspの実行
    ↓
Notifier (DynamoDB) / Metrics (CloudWatch)
```

### worker.tsの変更

#### 変更前

```typescript
// グローバル変数
let CURRENT_MEETING_ID = process.env.MEETING_ID || '';
const window = new WindowBuffer();
const notesStore = new NotesStore();
const graspQueue = new GraspQueue();
const grasps: Grasp[] = [];

// メッセージ処理
if (CURRENT_MEETING_ID && ev.meetingId !== CURRENT_MEETING_ID) {
  // Skip
}
```

#### 変更後

```typescript
// OrchestratorManager インスタンス
let orchestratorManager: OrchestratorManager;
const graspTemplates: Grasp[] = [];

// メッセージ処理
await orchestratorManager.processTranscriptEvent(ev, notifier, metrics);
```

## 利点

### 1. 並行処理のサポート

- 複数のミーティングを同時に処理可能
- 各ミーティングは独立して動作
- ミーティング間での干渉がない

### 2. スケーラビリティ

- 最大100ミーティング（設定可能）まで対応
- リソースの効率的な管理
- 非アクティブなミーティングの自動クリーンアップ

### 3. 状態の分離

- 各ミーティングは専用の`WindowBuffer`、`Notebook`、`GraspQueue`を持つ
- ミーティングごとに独立した処理履歴
- データの混在リスクがない

### 4. メンテナンス性の向上

- 責務が明確に分離されたクラス構造
- テストが容易
- 新機能の追加が簡単

## 環境変数

新しい環境変数:

- `MAX_MEETINGS`: 最大同時ミーティング数（デフォルト: 100）
- `MEETING_TIMEOUT_MS`: 非アクティブタイムアウト（デフォルト: 3600000 = 1時間）

削除された環境変数:

- `MEETING_ID`: 複数ミーティング対応により不要
- `WINDOW_LINES`: `MeetingOrchestrator`の設定に移行（必要に応じて）
- `POLL_INTERVAL_MS`: SQS long pollingにより不要

## テスト

新しいテストスイート `multiMeeting.test.ts` を追加しました:

- **17のテストケース**を含む
- 以下をカバー:
  - 単一ミーティングの基本機能
  - 複数ミーティングの並行処理
  - ミーティング間の分離
  - リソース管理（最大数、タイムアウト）
  - スケーラビリティ（20ミーティング同時処理）

すべてのテストは成功し、既存のテストも影響を受けていません（合計88テストが成功）。

## パフォーマンス考慮事項

### メモリ使用量

各`MeetingOrchestrator`は以下のメモリを使用します:

- `WindowBuffer`: 発話履歴（通常は数KB）
- `Notebook`: メモ履歴（数KB〜数十KB）
- `GraspQueue`: キュー内のGrasp参照（数百バイト）

100ミーティングの場合でも、合計メモリ使用量は数MB程度と推定されます。

### CPU使用量

- 各ミーティングは独立して処理されます
- Graspの実行はミーティングごとにシリアライズされます（グローバルクールダウン）
- LLM呼び出しは非同期で処理され、ブロッキングしません

### クリーンアップ戦略

- 非アクティブなミーティングは定期的にクリーンアップされます（100ループごと）
- タイムアウトはデフォルト1時間（設定可能）
- 最大ミーティング数に達した場合、即座にクリーンアップを実行

## 今後の拡張可能性

このアーキテクチャは以下の拡張に対応しやすくなっています:

1. **ミーティングごとの異なる設定**: 各`MeetingOrchestrator`に異なる`Grasp`設定を適用可能
2. **優先度管理**: 重要なミーティングに優先的にリソースを割り当て
3. **永続化**: ミーティング状態をDynamoDBに保存して復元可能に
4. **分散処理**: 複数のワーカーインスタンス間でミーティングを分散

## まとめ

新しいアーキテクチャにより、timtamオーケストレーターは:

- ✅ 複数ミーティングの並行処理をサポート
- ✅ ミーティング間の完全な分離を保証
- ✅ スケーラブルで効率的なリソース管理
- ✅ メンテナンス性とテスト容易性の向上

これにより、実際の運用環境で複数のミーティングが同時に行われる場合でも、安定した動作が保証されます。
