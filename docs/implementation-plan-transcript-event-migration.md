# 実装計画: ChimeSDK TranscriptEvent移行

## 概要

Issue #8「発言者を特定して促せるようにしたい」に対応するため、現在のサーバー側文字起こしパス（Media Capture Pipeline → S3 → Transcribe Batch → Kinesis）から、クライアント側TranscriptEventをサーバーに送信する方式に移行する。

## 目的

1. **話者特定**: ChimeSDK TranscriptEventに含まれるattendeeId情報をオーケストレーターに届ける
2. **レイテンシ改善**: バッチ文字起こしのポーリング待機（1-60秒）を排除
3. **将来の拡張性**: ADR 0009で検討しているサードパーティ会議サービス統合に向けた基盤作り

## 新アーキテクチャ

### データフロー

```
ブラウザ (TranscriptEvent受信)
  ↓ attendeeId + text抽出
  ↓ HTTP POST
新API Endpoint (/meetings/{meetingId}/transcription/events)
  ↓ Lambda関数
  ↓ AsrEvent形式に変換
Kinesis (transcript-asr)
  ↓ 既存フロー
Orchestrator (worker.ts)
  ↓ speakerId利用可能
LLM判定 (話者名で呼びかけ可能)
  ↓
DynamoDB (ai-messages)
```

### 主要な変更点

| コンポーネント | 現在 | 移行後 |
|--------------|------|--------|
| **文字起こし元** | Media Capture Pipeline → Transcribe Batch | TranscriptEvent (ブラウザ) |
| **話者情報** | なし (speakerId: undefined) | あり (attendeeId) |
| **レイテンシ** | 1-60秒のポーリング | リアルタイム (WebSocket) |
| **データパス** | S3 → Lambda → Kinesis | ブラウザ → API → Kinesis |
| **冗長性** | サーバー側のみ | なし (Phase 1では削除) |

## 影響範囲の特定

### 削除するコンポーネント

1. **services/audio-consumer/** (完全削除)
   - `handler.ts`: S3イベント → Transcribe Batch → Kinesis
   - `package.json`
   - `tsconfig.json`

2. **Media Capture Pipeline** (transcriptionStart.tsから削除)
   - `CreateMediaCapturePipelineCommand`の呼び出し
   - S3バケットへの音声保存ロジック

3. **インフラ** (infra/cdk/lib/stack.ts)
   - `mediaCaptureBucket`: S3バケット (削除)
   - `audioConsumerFn`: Lambda関数 (削除)
   - S3イベント通知設定 (削除)
   - Transcribe権限 (削除)
   - `mediaPipelineTable`: DynamoDB (削除、transcriptionStart/Stopで使用していない)

### 変更するファイル

#### 1. web/timtam-web/src/App.tsx

**変更箇所**: 236-280行目 (TranscriptEventハンドラー)

**現在の実装**:
```typescript
const handler = (event: any) => {
  // テキストのみ抽出してブラウザ表示
  const text = alt?.Transcript ?? alt?.transcript ?? '';
  setFinalSegments(prev => [...prev, { text, at: Date.now() }]);
};
```

**変更後**:
```typescript
const handler = (event: any) => {
  // 1. attendeeId情報を抽出
  const items = alt?.Items ?? alt?.items ?? [];
  const speakerInfo = items.map(item => ({
    attendeeId: item?.Attendee?.AttendeeId ?? item?.attendee?.attendeeId,
    externalUserId: item?.Attendee?.ExternalUserId ?? item?.attendee?.externalUserId,
  }));

  // 2. テキストとattendeeIdをブラウザ表示
  setFinalSegments(prev => [...prev, {
    text,
    at: Date.now(),
    speakerId: speakerInfo[0]?.attendeeId // 最初の話者を取得
  }]);

  // 3. サーバーに送信 (isFinal時のみ)
  if (!isPartial) {
    sendTranscriptToServer(meetingId, text, speakerInfo[0]?.attendeeId);
  }
};
```

**新規関数**:
```typescript
async function sendTranscriptToServer(
  meetingId: string,
  text: string,
  speakerId?: string
) {
  try {
    await fetch(`${apiUrl}/meetings/${meetingId}/transcription/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        speakerId,
        timestamp: Date.now(),
        isFinal: true,
      }),
    });
  } catch (err) {
    console.error('Failed to send transcript to server', err);
    // エラーは無視 (ブラウザ表示には影響させない)
  }
}
```

#### 2. services/meeting-api/transcriptionStart.ts

**削除する処理**:
- `CreateMediaCapturePipelineCommand` (57-84行目)
- DynamoDB保存 (94-105行目)
- PIPELINE_TABLE_NAME環境変数の参照

**残す処理**:
- `StartMeetingTranscriptionCommand` (36-48行目) - クライアント側文字起こしは継続

**変更後のコード**:
```typescript
export const start: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const pathId = event.pathParameters?.meetingId;
    const meetingId: string | undefined = pathId || body.meetingId;
    if (!meetingId) throw new Error('meetingId is required');

    const languageCode = body.languageCode || 'ja-JP';

    // Start client-side transcription for browser display and server forwarding
    const clientResp = await chime.send(
      new StartMeetingTranscriptionCommand({
        MeetingId: meetingId,
        TranscriptionConfiguration: {
          EngineTranscribeSettings: {
            LanguageCode: languageCode,
            Region: REGION,
            EnablePartialResultsStabilization: true,
            PartialResultsStability: 'medium',
          },
        },
      })
    );

    console.log('[TranscriptionStart] Client-side transcription started', {
      meetingId,
      requestId: (clientResp as any)?.$metadata?.requestId
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        meetingId,
        languageCode,
      }),
    };
  } catch (err: any) {
    console.error('[TranscriptionStart] failed', err?.message || err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err?.message || String(err) }),
    };
  }
};
```

#### 3. services/meeting-api/transcriptionStop.ts

**削除する処理**:
- Media Pipeline削除ロジック (DynamoDB参照、DeleteMediaCapturePipeline)
- PIPELINE_TABLE_NAME環境変数の参照

**残す処理**:
- `StopMeetingTranscriptionCommand`

#### 4. 新規ファイル: services/meeting-api/transcriptionEvents.ts

**新規API Endpoint**: POST /meetings/{meetingId}/transcription/events

```typescript
import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { KinesisClient, PutRecordCommand } from '@aws-sdk/client-kinesis';

const KINESIS_STREAM_NAME = process.env.KINESIS_STREAM_NAME || 'transcript-asr';
const kinesis = new KinesisClient({});

type TranscriptEventRequest = {
  text: string;
  speakerId?: string;
  timestamp?: number;
  isFinal: boolean;
};

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const meetingId = event.pathParameters?.meetingId;
    if (!meetingId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'meetingId is required' }),
      };
    }

    const body: TranscriptEventRequest = event.body
      ? JSON.parse(event.body)
      : {};

    if (!body.text) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'text is required' }),
      };
    }

    // Only process final transcripts
    if (!body.isFinal) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, processed: false }),
      };
    }

    // Format as AsrEvent for Orchestrator
    const asrEvent = {
      meetingId,
      speakerId: body.speakerId,
      text: body.text,
      isFinal: body.isFinal,
      timestamp: body.timestamp || Date.now(),
      sequenceNumber: undefined,
    };

    // Write to Kinesis
    await kinesis.send(
      new PutRecordCommand({
        StreamName: KINESIS_STREAM_NAME,
        Data: Buffer.from(JSON.stringify(asrEvent)),
        PartitionKey: meetingId,
      })
    );

    console.log('[TranscriptEvents] Event written to Kinesis', {
      meetingId,
      speakerId: body.speakerId,
      textLength: body.text.length,
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, processed: true }),
    };
  } catch (err: any) {
    console.error('[TranscriptEvents] failed', err?.message || err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err?.message || String(err) }),
    };
  }
};
```

#### 5. infra/cdk/lib/stack.ts

**削除**:
- `mediaCaptureBucket`: 64-101行目
- `mediaPipelineTable`: 27-33行目
- `audioConsumerFn`: 193-200行目以降
- S3イベント通知設定
- Media Pipeline関連のIAM権限 (158-167行目)

**追加**:
- 新しいAPI Endpoint: POST /meetings/{meetingId}/transcription/events
- 新Lambda関数: `transcriptionEventsFn`
- Kinesis書き込み権限

**変更箇所**:
```typescript
// 削除: mediaPipelineTable
// 削除: mediaCaptureBucket
// 削除: audioConsumerFn

// transcriptionStartFn の環境変数を削除
const transcriptionStartFn = new NodejsFunction(this, 'TranscriptionStartFn', {
  entry: '../../services/meeting-api/transcriptionStart.ts',
  handler: 'start',
  timeout: Duration.seconds(15),
  runtime: lambda.Runtime.NODEJS_20_X,
  // PIPELINE_TABLE_NAME, CAPTURE_BUCKET_ARN, AWS_ACCOUNT_ID を削除
});

// transcriptionStopFn の環境変数を削除
const transcriptionStopFn = new NodejsFunction(this, 'TranscriptionStopFn', {
  entry: '../../services/meeting-api/transcriptionStop.ts',
  handler: 'stop',
  timeout: Duration.seconds(15),
  runtime: lambda.Runtime.NODEJS_20_X,
  // PIPELINE_TABLE_NAME を削除
});

// 新規: TranscriptEvents Lambda
const transcriptionEventsFn = new NodejsFunction(this, 'TranscriptionEventsFn', {
  entry: '../../services/meeting-api/transcriptionEvents.ts',
  handler: 'handler',
  timeout: Duration.seconds(10),
  runtime: lambda.Runtime.NODEJS_20_X,
  environment: {
    KINESIS_STREAM_NAME: transcriptStream.streamName,
  },
});

// Grant Kinesis write permission
transcriptStream.grantWrite(transcriptionEventsFn);

// 削除: mediaPipelinePolicies (158-167行目)
// 削除: mediaPipelineTable.grantReadWriteData
// 削除: mediaCaptureBucket.grantReadWrite

// API Gateway ルート追加 (既存のルート定義部分に追加)
// POST /meetings/{meetingId}/transcription/events
```

#### 6. services/orchestrator/worker.ts

**変更**: speakerIdを利用するロジック追加

**現在の実装**:
```typescript
type AsrEvent = {
  meetingId: string;
  speakerId?: string; // 常にundefined
  text: string;
  isFinal: boolean;
  timestamp?: number;
  sequenceNumber?: string;
};

// worker.ts:276
window.push(ev.text); // speakerIdを無視
```

**変更後**:
```typescript
// 型定義は変更不要 (すでにspeakerIdフィールドあり)

// worker.ts:276付近
const displayText = ev.speakerId
  ? `[${ev.speakerId}] ${ev.text}`
  : ev.text;
window.push(displayText);

// LLMプロンプトにも反映 (worker.ts:78-84)
const prompt =
  `以下は会議の直近確定発話です。話者IDが表示されている場合は、その人物に呼びかけることができます。\n` +
  CURRENT_PROMPT + `\n` +
  `\n` +
  '介入が必要かを判断し、次のJSON形式だけを厳密に返してください:\n' +
  '{"should_intervene": boolean, "reason": string, "message": string}\n' +
  '---\n' + windowText;
```

### 新規作成するファイル

1. **services/meeting-api/transcriptionEvents.ts** (上記参照)
2. **このドキュメント**: docs/implementation-plan-transcript-event-migration.md

### 削除するファイル

1. **services/audio-consumer/handler.ts**
2. **services/audio-consumer/package.json**
3. **services/audio-consumer/tsconfig.json**

## 移行戦略

### Phase 1: 新方式への完全移行 (推奨)

**メリット**:
- シンプル (2つの文字起こしパスを維持しない)
- コスト削減 (S3、Transcribe Batch、Lambda実行時間)
- レイテンシ改善

**デメリット**:
- ブラウザ接続が切れると文字起こしが停止
- ADR 0008で懸念されていた冗長性の喪失

**推奨理由**:
- PoCフェーズでは、冗長性よりもシンプルさを優先
- ブラウザ接続が切れる状況は稀 (会議参加者が全員退出 = 会議終了)
- 将来的にサードパーティ会議サービス (Zoom/Meet) に移行する際も、ボットが音声を受信する形になるため、現在のサーバー側パスは使えない

### Phase 2 (将来): 冗長性の追加 (オプション)

もし冗長性が必要になった場合:

1. **両方のパスを維持**:
   - クライアント側 (speakerId付き) を優先
   - サーバー側 (speakerId無し) をフォールバック
   - Orchestratorで重複排除 (timestamp/sequenceNumberで判定)

2. **実装コスト**: 中程度 (重複排除ロジック、状態管理)

現時点では**Phase 1のみ実装**を推奨。

## 実装手順

### ステップ1: 新API Endpointの実装

1. `services/meeting-api/transcriptionEvents.ts` を作成
2. `infra/cdk/lib/stack.ts` に Lambda関数とAPI Gatewayルートを追加
3. デプロイして動作確認 (curlでテスト)

### ステップ2: ブラウザ側の実装

1. `web/timtam-web/src/App.tsx` のTranscriptEventハンドラーを変更
2. `sendTranscriptToServer` 関数を追加
3. ローカルでテスト (Chime会議を開いて文字起こし動作確認)

### ステップ3: 旧コンポーネントの削除

1. `services/meeting-api/transcriptionStart.ts` からMedia Pipeline関連コードを削除
2. `services/meeting-api/transcriptionStop.ts` からMedia Pipeline関連コードを削除
3. `services/audio-consumer/` ディレクトリを削除
4. `infra/cdk/lib/stack.ts` から以下を削除:
   - `mediaCaptureBucket`
   - `mediaPipelineTable`
   - `audioConsumerFn`
   - 関連IAM権限
   - S3イベント通知

### ステップ4: Orchestratorの改善

1. `services/orchestrator/worker.ts` でspeakerIdを表示
2. LLMプロンプトに話者情報を含める

### ステップ5: テスト

1. **統合テスト**:
   - Chime会議を作成
   - 複数参加者で発言
   - ブラウザにspeakerIdが表示されるか確認
   - Orchestratorログで `[attendeeId] text` 形式で表示されるか確認
   - LLMが話者を特定して介入するか確認

2. **エラーケース**:
   - ブラウザ → API間のネットワークエラー
   - Kinesis書き込みエラー
   - attendeeIdが取得できない場合

### ステップ6: ドキュメント更新

1. ADR 0008の更新 (Status: Superseded)
2. ADR 0010 (新規): TranscriptEvent-based Architecture
3. docs/architecture.md の図を更新

## リスク評価

| リスク | 影響度 | 対策 |
|-------|--------|------|
| **ブラウザ接続切断** | 中 | Phase 1では許容。将来的にサーバー側パスを追加可能 |
| **attendeeId取得失敗** | 低 | フォールバック: speakerId=undefined (現在と同じ) |
| **API呼び出し失敗** | 低 | ブラウザ側でエラー無視。ログに記録のみ |
| **レイテンシ増加** | 極低 | ブラウザ→API→Kinesisは既存パスより高速 |
| **コスト増加** | なし | 逆に削減 (S3、Transcribe Batch削除) |

## コスト影響

### 削減されるコスト

1. **S3ストレージ**: $0.023/GB/月 (音声ファイル保存不要)
2. **Transcribe Batch**: $0.024/分 (日本語)
3. **Lambda実行時間**: audio-consumer (最大5分/ファイル)

### 追加されるコスト

1. **API Gateway呼び出し**: $1.00/百万リクエスト (微増)
2. **Lambda実行時間**: transcriptionEvents (数ミリ秒/リクエスト、微増)

**総合**: コスト削減 (特にTranscribe Batch料金が大きい)

## 成功基準

1. **機能**: 発言者IDがOrchestratorに届く
2. **レイテンシ**: E2Eレイテンシが1.5-3.0秒以内 (ADR 0002目標)
3. **安定性**: 10分間の会議で文字起こしロストがない
4. **コスト**: 既存実装より低コスト

## 未決事項

1. **externalUserIdの利用**: attendeeIdとexternalUserIdのどちらを使うか (現時点ではattendeeIdを使用、将来的に名前マッピングを追加可能)
2. **partial resultの扱い**: isFinal=falseも送信するか (Phase 1では送信しない)
3. **ADR 0008のステータス**: Superseded vs Deprecated (要確認)

## 次のステップ

1. **やっとむの確認**: この実装計画で問題ないか確認
2. **実装開始**: 承認後、ステップ1から順次実装
3. **PR作成**: 各ステップごとにPRを作成、またはまとめて1つのPR

---

**作成日**: 2025-12-17
**関連Issue**: #8
**関連ADR**: ADR 0008, ADR 0009
