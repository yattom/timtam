# ADR 0011: トランスクリプトストリーミングにSQS FIFOを使用

- Status: Proposed
- Date: 2025-12-25
- Owners: timtam PoC チーム

## 背景 / Context

現在、ブラウザから送信されるトランスクリプトイベントは以下の流れで処理されている:

```
Browser → API Gateway Lambda → Kinesis Data Stream → ECS Orchestrator
```

**現在のKinesis実装** (`infra/cdk/lib/stack.ts:67-72`):
- Stream名: `transcript-asr`
- Mode: PROVISIONED (1 shard)
- Retention: 24時間
- PartitionKey: meetingId（順序保証のため）

**実装の特徴**:
- 単一コンシューマー（ECS Orchestrator）のみ
- カスタムポーリングロジック（`GetShardIterator` + `GetRecords`）
- アプリケーションレベルでmeetingIDフィルタリング
- Kinesis Consumer APIを使用していない

**非標準パターンの理由** (`stack.ts:65-66`):
> Use PROVISIONED with 1 shard since orchestrator reads from single shard only
> and filters by CURRENT_MEETING_ID (non-standard consumer pattern)

### 問題点

1. **アーキテクチャのミスマッチ**: Kinesisは複数コンシューマー向けに設計されているが、実際は単一コンシューマーしか使用していない
2. **実装の複雑さ**: カスタムポーリングロジック（`worker.ts:219-230`）の保守が必要
3. **コスト効率**: 低スループットな用途でKinesis PROVISIONEDを使用するのは非効率的
4. **未使用機能**: 24時間リテンション、リプレイ機能などを活用していない

## 調査結果 / Research Findings

### 現在のスループット特性

- **書き込み頻度**: 音声認識の最終トランスクリプト（`isFinal: true`）のみ処理
- **想定レート**: 1会議あたり数イベント/秒程度（発話頻度に依存）
- **ピーク**: 複数会議同時開催時でも数十イベント/秒レベル

### SQS FIFOの特性

**制限**:
- スループット上限: 300 TPS（Message Group ID単位）または3000 TPS（高スループットモード）
- Message Group ID: meetingIdを使用すれば、会議ごとに順序保証
- 最大保持期間: 14日（Kinesisの24時間より長い）

**利点**:
- ネイティブなlong polling（`WaitTimeSeconds`で最大20秒）
- Dead Letter Queue（DLQ）内蔵
- シンプルなAPI（`SendMessage` / `ReceiveMessage`）
- 従量課金（リクエストベース）

### コスト比較

**Kinesis PROVISIONED (1 shard)**:
- 基本料金: $0.015/shard/hour = **$10.80/月**
- PUT Payload Units: $0.014/100万ユニット
- 合計: 約$11〜15/月（低スループットでも固定費が発生）

**SQS FIFO**:
- リクエスト: $0.50/100万リクエスト
- 想定: 1万イベント/日 × 30日 = 30万イベント/月
- 合計: **$0.15〜0.50/月**（スループット依存）

コスト削減効果: **約95%削減**（低スループット時）

### 他のAWSサービス比較

**EventBridge**:
- リアルタイムイベントバス
- ❌ 順序保証がない（FIFOモードなし）
- ❌ 現在のPartitionKey=meetingIdパターンが使えない

**Redis Streams** (ElastiCache):
- 超低レイテンシ（サブミリ秒）
- ❌ インフラ管理コスト（ElastiCache維持費: 最低$15〜50/月）
- ❌ 運用複雑度が高い
- ❌ 現在の1-3秒レイテンシ目標には不要

## 決定 / Decision

**トランスクリプトストリーミングにAmazon SQS FIFOを採用する（提案）**

理由:
1. **アーキテクチャの適合性**: 単一コンシューマーパターンに最適
2. **シンプル化**: カスタムポーリングロジック削減
3. **コスト最適化**: 低スループット時に95%削減
4. **機能十分性**: 順序保証、DLQ、long pollingすべて標準提供

## アーキテクチャ / Architecture

### 新しいデータフロー

```
Browser
  ↓
POST /meetings/{meetingId}/transcription/events
  ↓
TranscriptionEvents Lambda
  ├─ SendMessageCommand
  ├─ MessageGroupId: meetingId
  └─ MessageBody: JSON.stringify(AsrEvent)
  ↓
SQS FIFO Queue (transcript-asr.fifo)
  ↓
ECS Orchestrator (Worker)
  ├─ ReceiveMessageCommand (long polling)
  ├─ WaitTimeSeconds: 20
  └─ MaxNumberOfMessages: 10
  ↓
LLM Judgment → DynamoDB
```

### Queue設定

```typescript
const transcriptQueue = new sqs.Queue(this, 'TranscriptAsrQueue', {
  queueName: 'transcript-asr.fifo',
  fifo: true,
  contentBasedDeduplication: true,  // 同じトランスクリプトの重複送信を防ぐ
  visibilityTimeout: Duration.seconds(30),
  retentionPeriod: Duration.days(1),  // Kinesisと同じ24時間
  deadLetterQueue: {
    queue: deadLetterQueue,
    maxReceiveCount: 3,
  },
});
```

### コード変更箇所

**Producer側** (`services/meeting-api/transcriptionEvents.ts`):
```typescript
// Before: Kinesis PutRecordCommand
await kinesis.send(
  new PutRecordCommand({
    StreamName: KINESIS_STREAM_NAME,
    Data: Buffer.from(JSON.stringify(asrEvent)),
    PartitionKey: pathMeetingId,
  })
);

// After: SQS SendMessageCommand
await sqs.send(
  new SendMessageCommand({
    QueueUrl: TRANSCRIPT_QUEUE_URL,
    MessageBody: JSON.stringify(asrEvent),
    MessageGroupId: pathMeetingId,  // 会議ごとに順序保証
  })
);
```

**Consumer側** (`services/orchestrator/worker.ts`):
```typescript
// Before: Custom Kinesis polling (219-230行, 253-254行)
const desc = await kinesis.send(new DescribeStreamCommand({ StreamName }));
const shardId = desc.StreamDescription?.Shards?.[0]?.ShardId;
const recs = await kinesis.send(new GetRecordsCommand({ ShardIterator, Limit: 100 }));
// ... 複雑なイテレータ管理

// After: Simple SQS long polling
const result = await sqs.send(
  new ReceiveMessageCommand({
    QueueUrl: TRANSCRIPT_QUEUE_URL,
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 20,  // Long polling
  })
);

for (const message of result.Messages || []) {
  const asrEvent: AsrEvent = JSON.parse(message.Body!);

  // 既存の処理ロジック（meetingIDフィルタ、window buffer等）
  if (asrEvent.meetingId !== CURRENT_MEETING_ID) continue;
  if (!asrEvent.isFinal) continue;
  // ... LLM judgment

  // 処理完了後に削除
  await sqs.send(
    new DeleteMessageCommand({
      QueueUrl: TRANSCRIPT_QUEUE_URL,
      ReceiptHandle: message.ReceiptHandle!,
    })
  );
}
```

### 削除されるコード

- `getShardIterator()` 関数（`worker.ts:219-230`）
- シャードイテレータ管理ロジック
- Kinesis Stream定義（`stack.ts:67-72`）
- Kinesis IAM権限（`grantWrite`, `DescribeStream`, `GetShardIterator`, `GetRecords`）

### 追加されるコード

- SQS Queue定義（FIFO + DLQ）
- SQS IAM権限（`SendMessage`, `ReceiveMessage`, `DeleteMessage`）
- 環境変数: `TRANSCRIPT_QUEUE_URL`（`KINESIS_STREAM_NAME`の置き換え）

## 影響 / Consequences

### ポジティブ

1. **コード削減**: 約20-30行のカスタムポーリングロジックが削除
2. **保守性向上**: AWS標準パターンに準拠
3. **エラーハンドリング**: DLQで処理失敗メッセージを自動的に隔離
4. **コスト削減**: 月額約$10削減（95%削減）
5. **スケーラビリティ**: 高スループットモード（3000 TPS）への移行が容易

### ネガティブ

1. **リプレイ不可**: Kinesisのような過去データ再読み込み機能はない（ただし現在未使用）
2. **複数コンシューマー不可**: 将来的に複数Orchestratorが必要になった場合は再設計が必要
3. **マイグレーション作業**: Lambda、ECS Taskの両方でコード変更が必要

### リスク軽減策

**リプレイ機能が将来必要になった場合**:
- DynamoDBに全トランスクリプトを保存し、バッチ処理でリプレイ
- または、その時点でKinesis/Kafka等に移行

**複数コンシューマーが必要になった場合**:
- SNS + SQS Fanoutパターンに移行
- または、EventBridge + 複数SQS FIFOに変更

**移行時のダウンタイム**:
- Blue-Green Deployment: 新旧両方のキューに並行送信
- 段階的移行: Orchestratorを新キューに切り替え後、旧Kinesisを削除

## 代替案 / Alternatives Considered

### 代替案A: Kinesis Data Streams (ON_DEMAND)

**概要**: PROVISIONEDをON_DEMANDに変更

**メリット**:
- コード変更不要
- スループットが自動スケール

**デメリット**:
- ❌ 最低料金: $0.40/shard/hour = **$288/月**（PROVISIONEDより高い）
- ❌ 低スループット時はSQSより20倍以上高コスト

**却下理由**: コスト増加、アーキテクチャのミスマッチは未解決

### 代替案B: EventBridge + Lambda

**概要**: Lambdaを直接トリガー

**メリット**:
- サーバーレス
- スケーラビリティ

**デメリット**:
- ❌ 順序保証が困難（EventBridgeはFIFOなし）
- ❌ Orchestratorの長時間実行ロジック（window buffer、cooldown）をLambdaに適合させるのが困難
- ❌ ECS Fargateの既存実装を大幅に変更

**却下理由**: アーキテクチャ変更が大きすぎる

### 代替案C: Kinesisのまま維持

**概要**: 現状維持

**メリット**:
- 変更リスクなし
- リプレイ機能を維持

**デメリット**:
- ❌ コスト非効率（$10/月の固定費）
- ❌ カスタムポーリングロジックの保守負担
- ❌ 非標準パターンの継続

**却下理由**: 改善機会を逃す

## 実装計画 / Implementation Plan

### Phase 1: 並行運用（リスク軽減）

1. SQS FIFO Queueを作成（DLQ含む）
2. Lambda: Kinesis PutRecord + SQS SendMessageを**両方**実行
3. Orchestrator: SQS ReceiveMessageに切り替え
4. 1-2週間運用して安定性を確認

### Phase 2: Kinesis削除

1. Lambda: SQS SendMessageのみに変更（Kinesis PutRecordを削除）
2. Kinesis Streamリソースを削除
3. 関連IAM権限、環境変数をクリーンアップ

### Phase 3: コードクリーンアップ

1. `worker.ts`の旧ポーリングロジックを削除
2. CloudWatch Metricsを確認（レイテンシ、エラーレート）
3. ドキュメント更新（`docs/architecture.md`等）

### ロールバック計画

- Phase 1中に問題が発生した場合: Orchestratorを旧Kinesisポーリングに戻す
- Phase 2後に問題が発生した場合: Kinesisを再作成し、Lambdaを巻き戻す

## 未決事項 / TBD

1. **DLQのアラート設定**: CloudWatch Alarmでメッセージ流入を監視するか
2. **メトリクス収集**: 現在のKinesis関連メトリクスをSQS用に置き換える必要性
3. **リプレイ要件の明確化**: 過去トランスクリプトの再処理が本当に不要か確認
4. **スループット増加時の対応**: 将来的に300 TPS超える可能性があるか（高スループットモードへの移行検討）

## 参考 / References

### AWS公式ドキュメント
- [Amazon SQS FIFO Queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues.html)
- [SQS Message Ordering](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-message-order.html)
- [Kinesis Data Streams Pricing](https://aws.amazon.com/kinesis/data-streams/pricing/)
- [SQS Pricing](https://aws.amazon.com/sqs/pricing/)

### 関連ADR
- ADR 0002: リアルタイム性（レイテンシ要件）
- ADR 0003: コスト（コスト最適化方針）
- ADR 0007: Orchestratorとブラウザの連携
- ADR 0009: サードパーティ会議サービス統合（将来的な拡張性）

### 関連ファイル
- `infra/cdk/lib/stack.ts:67-72` - Kinesis Stream定義
- `services/meeting-api/transcriptionEvents.ts:89-95` - Producer
- `services/orchestrator/worker.ts:219-230, 253-254, 267-310` - Consumer
