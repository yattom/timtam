# ADR 0008: Chime Media Pipelines for Server-Side Transcription

- Status: Accepted
- Date: 2025-12-15
- Owners: timtam PoC チーム

## 背景 / Context

当初の実装では、Chime SDK の `StartMeetingTranscriptionCommand` を使用してクライアント側で文字起こしを受信していた。これにより、ブラウザ上で文字起こし結果を表示することは可能だが、サーバー側のオーケストレータが文字起こしデータにアクセスできない問題が発覚した。

**現在の実装の問題点**:
```
Chime Meeting → [Chime内部のTranscribe] → WebSocket → Browser (表示のみ)
                                                        ↓
                                                   Kinesis には書き込まれない
                                                        ↓
                                            Orchestrator は recordCount=0
```

**アーキテクチャ要件**:
- docs/architecture.md: サーバー側で音声 → ASR → Kinesis → Orchestrator の流れが必要
- 将来的に Zoom/Google Meet に移行する際、サーバー側でボットが音声をキャプチャして Transcribe に送る必要がある
- PoC段階でもサーバー側アーキテクチャを正しく実装・検証すべき

## 決定 / Decision

**Amazon Chime SDK Media Pipelines** を使用して、サーバー側で音声キャプチャと文字起こしを実行する。

**実装方針**:
1. `transcriptionStart` Lambda で **CreateMediaCapturePipeline** API を呼び出し
2. Media Pipeline の設定:
   - Source: Chime Meeting の音声ストリーム
   - Sink: Amazon Transcribe Streaming
   - Transcribe Output: Kinesis Data Stream (`transcript-asr`)
3. Orchestrator は Kinesis から文字起こしイベントを消費（既存実装のまま）
4. ブラウザ側の文字起こし表示は以下のいずれか:
   - オプションA: クライアント側の `StartMeetingTranscriptionCommand` を併用（表示専用）
   - オプションB: WebSocket/SSE で Orchestrator から文字起こしをブラウザに配信
   - **Phase 1**: オプションA（既存のブラウザ表示を維持、実装が簡単）

## 理由 / Rationale

### サーバー側処理の必要性
- Orchestrator が LLM でトリガー判定するには、Kinesis 経由でデータを受け取る必要がある
- クライアント側のみの文字起こしでは、サーバー側ロジックが動作しない

### 将来の Zoom/Meet 移行との整合性

**重要**: Chime SDK Media Pipelines は **Chime 専用サービス** であり、Zoom/Meet では使用できない。

**Chime PoC (Chime SDK Media Pipelines 使用)**:
```
Chime Meeting → Chime SDK Media Pipelines → Transcribe Streaming → Kinesis → Orchestrator
                        ↑                           ↓
                Chime 専用サービス          ここから先が共通アーキテクチャ
```

**Zoom/Meet 本番 (カスタムボット使用)**:
```
Zoom/Meet → カスタムボット → Transcribe Streaming API → Kinesis → Orchestrator
            (Zoom/Meet API          ↓
             で音声キャプチャ)   ここから先が共通アーキテクチャ
```

**共通部分（プラットフォーム非依存）**:
- Amazon Transcribe Streaming (文字起こし)
- Kinesis Data Stream (イベントバス)
- Orchestrator 以降 (LLM トリガー判定、介入生成、TTS)

**プラットフォーム固有部分**:
- Chime: Chime SDK Media Pipelines が音声キャプチャと Transcribe 連携を自動処理
- Zoom/Meet: カスタムボットが音声キャプチャし、Transcribe Streaming API を直接呼び出す

Media Pipelines を使うことで、PoC 段階から **共通アーキテクチャ（Transcribe → Kinesis → Orchestrator）** を正しく検証できる。Zoom/Meet 移行時は音声キャプチャ部分のみを置き換えれば良い。

## 実装詳細 / Implementation Details

### 1. transcriptionStart.ts の変更
```typescript
// Before: StartMeetingTranscriptionCommand のみ
// After: CreateMediaCapturePipeline API を追加

import { ChimeSDKMediaPipelinesClient, CreateMediaCapturePipelineCommand } from '@aws-sdk/client-chime-sdk-media-pipelines';

// Media Pipeline を作成
// - ChimeSdkMeetingConfiguration: { ArtifactsConfiguration: { Audio: { MuxType: 'AudioWithActiveSpeakerVideo' } } }
// - Sink: S3 または Kinesis Video Streams (Transcribe が消費)
```

### 2. CDK スタックの変更
- Media Pipeline 用の IAM ロール作成
- `chime:CreateMediaCapturePipeline` 権限を Lambda に付与
- Transcribe の出力先として Kinesis Data Stream ARN を設定

### 3. transcriptionStop.ts の変更
- Media Pipeline の削除処理を追加
- Pipeline ARN を DynamoDB 等に保存して、停止時に削除

## 代替案 / Alternatives Considered

### 代替案 1: クライアント側で Kinesis に書き込む
```
Browser → [transcription events] → API Gateway → Lambda → Kinesis
```
- ❌ ブラウザの接続が切れると文字起こしデータが失われる
- ❌ クライアント側の実装が複雑
- ❌ 本番の Zoom/Meet 移行時に使えない

### 代替案 2: EventBridge 経由で Kinesis に書き込む
```
Chime Transcription → EventBridge → Lambda → Kinesis
```
- ❓ Chime の文字起こしイベントが EventBridge に配信されるか不明
- ❌ 調査が必要で実装に時間がかかる

## 影響 / Consequences

### 短期的な影響
- transcriptionStart/Stop Lambda の実装変更が必要
- CDK スタックに Media Pipeline リソースを追加
- Media Pipeline のライフサイクル管理（作成/削除/エラーハンドリング）

### 長期的な利点
- サーバー側アーキテクチャが正しく動作する
- Zoom/Meet 移行時に Orchestrator 以降のロジックを変更不要
- PoC で本番と同じデータフローを検証できる

## 参考 / References

- [Amazon Chime SDK Media Pipelines Documentation](https://docs.aws.amazon.com/chime-sdk/latest/dg/media-pipelines.html)
- [Amazon Transcribe Streaming](https://docs.aws.amazon.com/transcribe/latest/dg/streaming.html)
- docs/architecture.md: システムコンポーネント構成図
- ADR 0002: リアルタイム性（ASR 部分）
- ADR 0004: サービス選定（Transcribe Streaming）
