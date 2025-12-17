# ADR 0009: サードパーティ会議サービス統合アーキテクチャ

- Status: TBD
- Date: 2025-12-17
- Owners: timtam PoC チーム

## 背景 / Context

現在はPoCとしてAmazon Chime SDKを使用しているが、将来的にはZoom、Google Meet、Microsoft Teams等のサードパーティ会議サービスに生成AIファシリテーターが参加する形を想定している。

**現在のChime SDK実装**:
```
Chime Meeting → Media Pipelines → Transcribe → Kinesis → Orchestrator → LLM → TTS → Chime
```

**サードパーティ会議サービスへの要件**:
- 音声 and/or 文字起こしを受信
- LLMがレスポンスを生成
- チャット（テキスト）and/or 音声で会議サービスに送信
- 発言者の特定が可能（Issue #8）

現時点でどのようなアーキテクチャにしておくとよいか、YAGNIの精神でできるだけシンプルにしつつ、将来の拡張性も考慮する必要がある。

## 調査結果 / Research Findings

### 各プラットフォームのボットAPI（2025年12月時点）

#### Zoom
- **Zoom Meeting SDK**: サーバー上でZoomクライアントを実行し、音声・映像をリアルタイムキャプチャ
- **Zoom RTMS (Real-Time Media Streams)**: WebSocketベースで、リアルタイムに音声・映像・文字起こし・参加者メタデータにアクセス
- ✅ リアルタイム文字起こし対応
- ✅ 発言者識別（diarization）対応
- ✅ チャットAPI対応

#### Google Meet
- **Google Meet REST API**: 会議のメタデータ、録画、文字起こしにアクセス可能（会議終了後のみ）
- ❌ リアルタイム文字起こしの公式APIは存在しない
- ❌ ボットが会議に参加する公式APIも存在しない
- サードパーティサービス（Recall.ai、Vexa等）経由でのみリアルタイム対応可能

#### Microsoft Teams
- **Microsoft Graph API**: 会議終了後に文字起こし（.vtt）と録画（.mp4）を取得
- **Teams Calling Bot**: Azure Bot Frameworkを使用し、RTPオーディオパケットをリアルタイムで受信
- ⚠️ リアルタイム文字起こしは自分でAzure Cognitive Services Speech-to-Text等に送る必要あり
- ⚠️ 実装が最も複雑（OAuth、権限、WebRTC統合）
- ✅ チャットAPI対応

#### Webex
- **Webex Meeting Transcripts API**: 録画と文字起こしの取得（要Webex Assistant有効化）
- **Webex JavaScript SDK**: `receiveTranscription: true`でリアルタイム文字起こしイベントをリッスン
- ✅ リアルタイム文字起こし対応（要Webex Assistant）
- ✅ 2025年からAI要約・アクションアイテム自動生成

#### Slack Huddles
- ❌ Slack公式APIは存在しない
- 2025年7月からネイティブAI huddle notes機能（有料プラン）
- サードパーティサービス（Recall.ai等）経由でのみリアルタイム対応可能

#### Amazon Chime SDK
- 通常の参加者（Attendee）として会議に参加可能
- Media Pipelinesでサーバー側から音声キャプチャと文字起こしが可能（ADR 0008参照）
- ✅ ボットとしての参加に対応

### 標準的なボットパターン

Web会議ボットの標準的な実装パターン：

1. **ボット参加**: サーバー上で仮想的な会議参加者として動作
2. **データ取得方法**:
   - パターンA: 音声ストリーム取得 → 自前で文字起こし（Whisper/Deepgram/AssemblyAI）
   - パターンB: プラットフォーム提供の文字起こしをリアルタイム取得
3. **応答送信**: チャットAPI or 音声合成して音声送信

### Meeting Bot as a Service (BaaS)

複数プラットフォームの複雑さを吸収するサードパーティサービスが存在：

**商用サービス**:
- **Recall.ai**: Zoom, Google Meet, Teams, Webex, GoToMeeting, Slack Huddles対応。$0.30-$0.70/ボット時間
- **MeetingBaaS**: Zoom, Google Meet, Teams対応。統一API、カスタマイズ可能
- **Skribby.io**: 複数文字起こしモデル対応

**オープンソース/セルフホスト**:
- **Vexa**: Google Meet, Teams対応。Whisperで100言語対応、WebSocketでサブ秒レイテンシ。セルフホスト可能
- **ScreenApp Meeting Bot**: Zoom/Meet/Teams対応のオープンソース

**BaaSの利点**:
- 単一APIで複数プラットフォーム対応
- リアルタイム文字起こしと発言者識別が標準提供
- 各プラットフォームの認証・権限・WebRTC統合を回避
- 開発期間が最短（数日〜数週間）

**BaaSの課題**:
- 月額コスト（使用量ベース）
- 外部サービスへのデータ送信（プライバシー・セキュリティ）
- ベンダーロックインリスク

### 文字起こし技術（2025年最新）

**Whisperによるリアルタイム文字起こし**:
- **WhisperLiveKit**: Simul-Whisper/Streaming（2025年SOTA）、超低レイテンシ
- **SimulStreaming**: WhisperStreamingの後継、より高速・高品質
- **WhisperLive (Collabora)**: faster_whisper、TensorRT、OpenVINOの3バックエンド

Whisper本来の問題（完全な発話用設計、小チャンクで文脈喪失）は2025年の新実装で解決されている。

## 決定 / Decision

**Status: TBD**

現時点では決定を保留し、以下の3つの選択肢を提示する。最終決定はプロダクト要件、コスト、プライバシー要件、開発リソース等を総合的に判断して行う。

## アーキテクチャ選択肢 / Architecture Options

### 選択肢A: サードパーティBaaSを利用

**概要**: Recall.aiやMeetingBaaS等の統合APIサービスを利用

**アーキテクチャ**:
```
Zoom/Meet/Teams/Webex
  ↓ (BaaSボット参加)
Meeting BaaS API (Recall.ai / MeetingBaaS)
  ↓ WebSocket/Webhook (リアルタイム文字起こし + speaker info)
自社バックエンド (既存Orchestrator)
  ↓ 文字起こしテキスト + speaker
LLM (Amazon Bedrock)
  ↓ 応答テキスト
自社バックエンド
  ↓ BaaS API経由でチャット送信
サードパーティ会議サービス
```

**段階的移行**:
```
Phase 1: ChimeSDK PoC (現在)
  ChimeSDK → Orchestrator → LLM → ChimeSDK

Phase 2: BaaS並行導入
  ┌─ ChimeSDK → Orchestrator ─┐
  │                           ↓
  │                          LLM
  │                           ↑
  └─ BaaS → Orchestrator ─────┘

Phase 3 (オプション): セルフホスト移行 or プラットフォーム別実装
```

**共通インターフェース設計**:
```typescript
interface MeetingAdapter {
  // 文字起こしテキスト受信（発言者情報付き）
  onTranscript(callback: (text: string, speaker: Speaker) => void): void

  // チャットメッセージ送信
  sendMessage(text: string): Promise<void>

  // （オプション）音声応答
  sendAudio?(audioData: Buffer): Promise<void>
}

class ChimeSDKAdapter implements MeetingAdapter { ... }
class RecallAIAdapter implements MeetingAdapter { ... }
```

**メリット**:
- ✅ 単一APIで複数プラットフォーム対応
- ✅ 各プラットフォームの複雑な実装（認証、権限、WebRTC）を回避
- ✅ リアルタイム文字起こし + 発言者識別が標準提供（Issue #8対応）
- ✅ 開発期間が最短（数日〜数週間）
- ✅ ChimeSDKと同じインターフェースで統一可能

**デメリット**:
- ❌ 月額コスト（$0.30-$0.70/ボット時間）
- ❌ 外部サービスへのデータ送信（プライバシー・セキュリティ考慮必要）
- ❌ ベンダーロックインリスク

**適用場面**:
- 複数プラットフォームに早期対応したい
- 開発リソースが限られている
- プライバシー要件が厳しくない（または外部サービス利用が許容される）

### 選択肢B: オープンソースBaaSをセルフホスト

**概要**: VexaやScreenApp Meeting Bot等をAWS/GCP等にデプロイ

**アーキテクチャ**:
```
Zoom/Meet/Teams
  ↓ (セルフホストボット参加)
Vexa / ScreenApp Bot (自社AWS/ECS等)
  ↓ WebSocket (リアルタイム音声 or 文字起こし)
自社バックエンド (既存Orchestrator)
  ↓ (必要に応じて文字起こし: Whisper/Deepgram)
LLM (Amazon Bedrock)
  ↓ 応答
自社バックエンド
  ↓ ボット経由でチャット/音声送信
サードパーティ会議サービス
```

**メリット**:
- ✅ データを自社ネットワーク内に保持（プライバシー・セキュリティ）
- ✅ 使用量ベースコストではなく、インフラコストのみ
- ✅ カスタマイズ可能
- ✅ ベンダーロックインなし

**デメリット**:
- ❌ インフラ運用コスト（サーバー、保守、監視）
- ❌ 各プラットフォームのAPI変更への対応が必要
- ❌ 開発・保守リソースが必要
- ❌ 対応プラットフォームが限定的（Vexaは現状Google MeetとTeams中心）

**適用場面**:
- プライバシー・セキュリティ要件が厳しい
- インフラ運用能力がある
- 長期的なコスト最適化を重視

### 選択肢C: プラットフォームごとにネイティブAPI実装

**概要**: 各プラットフォームの公式SDKを直接使用

**アーキテクチャ**:
```
各プラットフォーム別実装:

Zoom:
  Zoom Meeting SDK / RTMS
    → 音声/文字起こし → Orchestrator → LLM → Zoom Chat API

Google Meet:
  ブラウザ自動化 or カスタムボット
    → 音声 → 文字起こし → Orchestrator → LLM → Meet Chat
  (公式APIが存在しないため実装困難)

Microsoft Teams:
  Teams Calling Bot + Graph API
    → RTP音声 → Azure STT → Orchestrator → LLM → Teams Chat

Webex:
  Webex JavaScript SDK
    → リアルタイム文字起こし → Orchestrator → LLM → Webex Chat

ChimeSDK:
  通常の参加者として参加
    → Media Pipelines → Transcribe → Orchestrator → LLM → Chime
```

**メリット**:
- ✅ 各プラットフォームの機能を最大限活用可能
- ✅ サードパーティサービスへの依存なし
- ✅ プラットフォーム固有の最適化が可能

**デメリット**:
- ❌ 開発工数が最大（プラットフォームごとに別実装）
- ❌ 各プラットフォームのAPI変更への対応が必要
- ❌ Google Meetは公式ボットAPIが存在せず実装困難
- ❌ Microsoft TeamsのCalling Botは権限・認証が複雑
- ❌ 保守コストが高い

**適用場面**:
- 特定のプラットフォームのみに対応する場合
- プラットフォーム固有の高度な機能が必要
- 完全なコントロールが必要

## 推奨事項 / Recommendations

現時点での**暫定推奨は選択肢A（サードパーティBaaS利用）**。理由：

1. **YAGNI原則**: 最小限の実装で複数プラットフォームに対応
2. **既存アーキテクチャとの整合性**: ChimeSDK PoCと同じインターフェース（テキスト受信→LLM→テキスト送信）を維持
3. **Issue #8対応**: 発言者識別が標準提供される
4. **開発速度**: 数日〜数週間で動作検証可能

ただし、最終決定には以下の検討が必要：
- プライバシー・セキュリティ要件の明確化（ADR 0001参照）
- 想定利用時間とコスト試算
- ベンダーロックインリスクの受容可否
- 段階的移行戦略（BaaS → セルフホスト）の可能性

## 影響 / Consequences

### 選択肢Aを選んだ場合の影響

**短期的な影響**:
- BaaSサービスの選定・契約が必要
- `MeetingAdapter`インターフェースの実装
- 既存OrchestratorのKinesisイベント処理をAdapter経由に抽象化
- BaaS Webhook/WebSocketエンドポイントの実装

**長期的な影響**:
- 月額コスト発生（使用量に応じて増加）
- 外部サービスへのデータ送信に関するコンプライアンス確認が必要
- プラットフォーム追加時の開発工数削減
- Chime PoCとサードパーティで同じOrchestratorロジックを共有可能

### 共通化すべきコンポーネント

どの選択肢でも、以下は共通化可能：
- **Orchestrator以降のロジック**: LLMトリガー判定、介入生成、応答送信（ADR 0002, 0007参照）
- **Amazon Transcribe or 文字起こしサービス**: プラットフォーム固有の音声キャプチャ部分のみ差し替え
- **Kinesis Data Stream**: イベントバスとして継続利用可能（ただしAdapter経由で抽象化）

### ChimeSDKへの影響

ChimeSDKに対しても「ボットとして参加」する形に統一することで、サードパーティサービスと同じアーキテクチャで扱える。Media Pipelinesは引き続き利用可能（ADR 0008）。

## 代替案 / Alternatives Considered

上記の選択肢A/B/Cに加えて検討した代替案：

### 代替案D: ハイブリッドアプローチ
- 主要プラットフォーム（Zoom/Teams）はBaaS利用
- ChimeSDKのみネイティブ実装（Media Pipelines）
- ❌ アーキテクチャが複雑化し、保守が困難

### 代替案E: プラットフォーム非依存の独自会議サービス
- Jitsi等のOSSをベースに自社会議サービスを構築
- ❌ ユーザーが既存のZoom/Meet/Teamsアカウントを使えないため、利便性が低い
- ❌ 開発・運用コストが膨大

## 未決事項 / TBD

最終決定前に以下を明確化する必要がある：

1. **プライバシー・セキュリティ要件**:
   - 会議データの外部サービス送信が許容されるか（ADR 0001参照）
   - セルフホストが必須か
   - データ保持期間・削除ポリシー

2. **コスト試算**:
   - 想定月間会議時間
   - BaaSコスト vs セルフホストインフラコスト vs 開発工数コスト

3. **対応プラットフォーム優先順位**:
   - 最初にどのプラットフォームに対応するか
   - ChimeSDK PoCからの移行タイミング

4. **発言者識別の詳細仕様** (Issue #8):
   - 発言者名の取得方法（各プラットフォームで異なる）
   - 匿名参加者の扱い
   - 表示名 vs 実名

5. **音声応答の要否**:
   - 現状はチャット（テキスト）のみだが、将来的に音声応答（TTS）が必要か
   - 必要な場合、各プラットフォームの音声送信APIの対応状況確認

6. **ベンダー選定基準**（選択肢Aの場合）:
   - Recall.ai vs MeetingBaaS vs その他
   - SLA、サポート体制、セキュリティ認証の確認

## 参考 / References

### 調査元（2025年12月時点）
- [Recall.ai - Meeting Bot API](https://www.recall.ai/product/meeting-bot-api)
- [Zoom Meeting Bot API](https://www.recall.ai/product/meeting-bot-api/zoom)
- [Google Meet Bot API](https://www.recall.ai/product/meeting-bot-api/google-meet)
- [Microsoft Teams Bot API](https://www.recall.ai/product/meeting-bot-api/microsoft-teams)
- [Meeting BaaS](https://www.meetingbaas.com/en)
- [GitHub - Vexa-ai/vexa](https://github.com/Vexa-ai/vexa)
- [GitHub - screenappai/meeting-bot](https://github.com/screenappai/meeting-bot)
- [WhisperLiveKit](https://github.com/QuentinFuxa/WhisperLiveKit)
- [WhisperLive (Collabora)](https://github.com/collabora/WhisperLive)
- [Amazon Chime SDK Documentation](https://docs.aws.amazon.com/chime-sdk/latest/dg/)

### 関連ADR
- ADR 0002: リアルタイム性（文字起こし部分）
- ADR 0004: サービス選定
- ADR 0007: Orchestratorとブラウザの連携
- ADR 0008: Chime Media Pipelinesによるサーバー側文字起こし（共通アーキテクチャの基礎）
- ADR 0001: セキュリティとプライバシー（外部サービス利用時の考慮事項）

### 関連Issue
- Issue #8: 発言者を特定して促せるようにしたい
