# ADR 0002: リアルタイム性（レイテンシ予算と処理方式）

- Status: Proposed
- Date: 2025-12-11
- Owners: timtam PoC チーム

## 背景 / Context
会議中の介入は低遅延が価値に直結する。PoCではチャット優先で 1.5–3.0秒（テキスト）、音声発話込み 2.5–4.5秒を目標とする。構成要素（ASR/LLM/TTS/バス/オーケストレーション）それぞれの遅延を抑える設計が必要。

## 決定 / Decision
- ストリーム処理: 音声→ASR→イベント→オーケストレーション→LLM→出力をストリーミング前提で実装。ポーリングは避ける。
- ASR: Amazon Transcribe Streaming（ja-JP, speaker labels, カスタム語彙）。部分結果を早期イベントとして利用。
- イベント伝搬: Kinesis Data Streams（低遅延）を第一候補。簡易ファンアウトはEventBridge。
- オーケストレーション: 常駐ワーカー（ECS Fargate）で状態管理と即時処理。長時間タスクは避ける。
- LLM: Bedrock小型（Claude 3.7 Haiku等）を優先し、短文生成を基本。必要時のみ大型をフェイルオーバー。
- TTS: Polly Neuralを優先。キャッシュ/先読みを検討（短文分割）。
- 計測: E2Eおよび各段のメトリクス（ASR受信→部分/確定、LLM開始/終了、TTS開始/終了）をCloudWatchに送出。

## 影響 / Consequences
- バッチ的な整形や大きな要約は経路外（非同期）に追い出す必要がある。
- ECS常駐によりコストが一定水準で発生するが、遅延の安定性が向上。

## 代替案 / Alternatives
- Step Functions Express中心: 設計は単純だが、サブ秒レイテンシと高頻度イベントには不向きな場面がある。
- 単一のLambdasチェーン: コールドスタートや連鎖で遅延ブレが生じやすい。

## 未決事項 / TBD
- KinesisとEventBridgeの使い分け基準の詳細
- LLMのモデル自動選択（短文/長文、負荷/コストに応じた切替）
- VAD/ノイズ抑制実装の具体ライブラリ

## 参考 / References
- AWS Kinesis Data Streams ベストプラクティス
- Amazon Transcribe Streaming ドキュメント
- Bedrock モデルのレイテンシ特性（公開資料）
