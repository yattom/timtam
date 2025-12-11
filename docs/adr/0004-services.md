# ADR 0004: 外部サービスとモデル選定（初期方針）

- Status: Proposed
- Date: 2025-12-11
- Owners: timtam PoC チーム

## 背景 / Context
PoCでは日本語会議を対象に、ASR/LLM/TTS/ベクトルDB/会議連携の各サービスを組み合わせて最小構成を実現する。将来的に品質・コスト・運用性に応じて差し替え可能な設計とする。

## 決定 / Decision（初期方針）
- 会議連携: Amazon Chime SDK（PoCはこれを前提）。将来のZoom/Teams/Meet対応は別ADR/実装で拡張
- ASR: Amazon Transcribe Streaming（日本語、話者分離、カスタム語彙）
  - 比較候補: Deepgram Nova-2, Google Cloud STT v2, OpenAI Realtime/Whisper v3 Turbo, AssemblyAI
- LLM（Bedrock）: Claude 3.7 Haikuを既定、必要時にSonnet。RAG/ツール使用に応じて Cohere Command R 系も検討
  - 代替/補完: Llama 3.2 70B Instruct, Mistral Large（コスト/速度とのトレードオフ）
- TTS: Amazon Polly Neural（ja-JP）。自然さ重視で ElevenLabs/Azure TTS を比較検証枠に追加
- ベクトルDB/検索: OpenSearch Serverless または Aurora PostgreSQL + pgvector のいずれか
  - 外部: Pinecone/Weaviate（必要時）
- ストレージ/ログ: S3（暗号化/KMS）、CloudWatch Logs/Metrics/X-Ray

## 選定基準 / Rationale
- 日本語の精度と遅延（ASR/LLM/TTS）
- AWS統合（ネットワーク/権限/監査/課金の一体管理）
- コスト（従量単価・固定費・スパイク耐性）
- 運用容易性（VPCエンドポイント、リージョン、監視）
- ポータビリティ（代替サービスへの切替容易性）

## 影響 / Consequences
- 初期はAWS中心で実装スピードを優先し、品質・コスト比較は一部の経路でA/B的に実施
- ベンダ比較のためのアダプタ層（ASR/LLM/TTSインターフェース）を用意する必要がある

## 代替案 / Alternatives
- マルチベンダ前提の抽象レイヤーを最初から厚く設計（初期速度低下の懸念）
- 自前ホスティング（ECS/EKS+GPU）でASR/LLM/TTSを内製（初期投資・運用負担増）

## 未決事項 / TBD
- 社内ドキュメントの接続先（Confluence/Google Drive/Notion/GitHubなど）
- ベクトルDBの最終選定（OpenSearch vs Aurora+pgvector）
- 音声合成の話者/スタイル選定、ブランドボイスの要否
- Zoom/Teams/Meet 連携の優先順位と認可設計

## 参考 / References
- Amazon Chime SDK, Transcribe Streaming, Bedrock, Polly の各ドキュメント
- Deepgram/Google/AssemblyAI/ElevenLabs/Azure の最新ベンチマーク
