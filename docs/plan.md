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

## TODOリスト

- [x] pnpmを使って危険なライブラリのインストールを防止
 - [x] Node.js/npm/aws-cdk のセットアップ確認
 - [x] CDK 初期化とブートストラップ
 - [x] HTTP API 作成
 - [x] Lambda meetingHandler 作成
 - [x] ルート追加 POST /meetings
 - [x] ルート追加 POST /attendees
 - [x] ルート追加 POST /meetings/{meetingId}/transcription/start
 - [x] ルート追加 POST /meetings/{meetingId}/transcription/stop
 - [x] Lambda orchestratorHandler 作成
 - [x] IAM 権限設定（Bedrock/Polly）
 - [x] cdk deploy
 - [ ] コンフィグレーションをCDK側に埋め込む
 - [x] IAM 権限設定（Chime/Transcribe）
 - [ ] CORS 設定（フロントオリジン）
 - [ ] Orchestrator 環境変数固定（BEDROCK_REGION / BEDROCK_INFERENCE_PROFILE_ID または ARN）
 - [ ] Lambda ランタイムを Node.js 20 に更新（全関数）
 - [ ] Web クライアント雛形作成（Vite + React）
 - [ ] API連携で入室（/meetings）と音声確認
 - [ ] トランスクリプト購読（Partial/Final）表示
 - [ ] 文字起こし開始/停止ボタン実装（Start/Stop API 接続）
 - [x] /events/transcript エンドポイント実装
 - [x] 簡易ルール→Bedrock判定（Haiku 4.5）実装
 - [ ] 介入メッセージをチャット欄に表示
 - [x] /tts エンドポイント実装（Polly）
 - [ ] フロントで音声ON/OFF切替と再生
 - [ ] レイテンシ簡易計測（ASR/LLM/TTS）

 ### 追加TODO（ADR0005に基づく）

 - [ ] GET /config エンドポイント実装（公開設定の提供）
 - [ ] CDK: Orchestrator/TTS の環境変数設定（BEDROCK_REGION / BEDROCK_MODEL_ID / TTS_DEFAULT_VOICE）
 - [ ] CDK: CloudFormation Outputs 追加（ApiEndpoint/DefaultRegion/DefaultModelId/TtsDefaultVoice）
 - [ ] IAM リソース絞り込み（Bedrock 推論プロファイル ARN / Polly Voice）
 - [ ] ヘルスチェックエンドポイント GET /health 追加


### Done

 - [x] AWSアカウント作成
 - [x] IAM Idencity CenterでSSO設定、ユーザーとグループ作成
 - [x] AWS CLI設定
 - [x] CloudTrail 有効化
 - [x] Budget作成
 - [x] Cost Anomaly 設定
 - [x] BedrockでAnthropicのモデル利用申請


## 設計・技術スタック（初期方針）
- 会議: Amazon Chime SDK（ブラウザクライアント）
- ASR: Amazon Transcribe Streaming（ja-JP, speaker labels）
- LLM: Amazon Bedrock（Claude Haiku 4.5 を既定、必要に応じて Sonnet 4.5 併用）
- 出力: 会議チャット（優先）、Polly TTS（任意）
- イベント: Kinesis Data Streams または EventBridge（必要に応じて）
- 実行: ECS Fargate常駐/またはStep Functions Express（将来拡張）
