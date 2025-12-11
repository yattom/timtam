# 開発計画

目的: 日本語会議にチャット優先で介入するAIアシスタントのPoCを、AWS（Chime SDK/Transcribe/Bedrock中心）で構築する。時期は設定しない。

## マイルストーン

1. Webブラウザをクライアントとした最低限の会議システム（複数人参加可能）上で、音声の文字起こしを表示する（保存なし）
   - Chime SDKを用いた最小会議（ブラウザ）
   - 音声をTranscribe Streaming（日本語）へ送出し、Partial/Finalをそのまま画面表示
   - S3/DynamoDB等への永続保存は行わない

2. 文字起こしをLLMに渡し、トリガーの判定と介入内容の出力をする（出力はまず文字、次に音声）
   - ルール（例: 無発話、キーワード）＋LLM評価でトリガー判定
   - 介入テキストを生成し、会議チャットへ投稿
   - 同内容をPollyで音声合成し、会議音声として出力（ON/OFF切替可）

3. 話者分離、短期メモリ、プロンプトの複雑化など
   - 話者分離（Transcribeの話者ラベル等）
   - 短期メモリ（直近ターンの保持/要約）
   - プロンプトの拡張（役割/方針/スタイル、few-shot、条件分岐）

4. 未整理の項目（現行計画からのまとめ）
   - RAG（S3/Confluence等）とベクトルDB（OpenSearch/Aurora pgvector）
   - ガードレール（Bedrock Guardrails）とPIIマスキング強化
   - 外部会議サービス連携（Zoom/Teams/Google Meet）
   - 運用・計測（CloudWatch/X‑Ray、レイテンシKPI可視化）
   - コスト最適化（要約頻度/トークン上限、モデル比較スイッチ）
   - 事後処理（自動議事録、Slack/Teams通知、Jira/Asana連携）

## 設計・技術スタック（初期方針）
- 会議: Amazon Chime SDK（ブラウザクライアント）
- ASR: Amazon Transcribe Streaming（ja-JP, speaker labels）
- LLM: Amazon Bedrock（Claude 3.7 Haiku中心）
- 出力: 会議チャット（優先）、Polly TTS（任意）
- イベント: Kinesis Data Streams または EventBridge（必要に応じて）
- 実行: ECS Fargate常駐/またはStep Functions Express（将来拡張）
