# 開発計画

目的: 日本語会議にチャット優先で介入するAIアシスタントのPoCを、AWS（Chime SDK/Transcribe/Bedrock中心）で構築する。時期は設定しない。

## マイルストーン

1. Grasp YAMLでプロンプトとLLM構成の自由度を高める
   - Done 2026.1.13
2. サードパーティ会議サービスと接続する
3. 一般ユーザーに使ってもらってフィードバックを得る
4. 未整理の項目（現行計画からのまとめ）
   - RAG（S3/Confluence等）とベクトルDB（OpenSearch/Aurora pgvector）
   - ガードレール（Bedrock Guardrails）とPIIマスキング強化
   - 外部会議サービス連携（Zoom/Teams/Google Meet）
   - 運用・計測（CloudWatch/X‑Ray、レイテンシKPI可視化）
   - コスト最適化（要約頻度/トークン上限、モデル比較スイッチ）
   - 事後処理（自動議事録、Slack/Teams通知、Jira/Asana連携）

## TODOリスト

NOTICE: TODOリストはフラットな箇条書きで、着手順に上から並べること。新しい項目もフラットに、実施順になるよう途中に挿入する。セクションを分けたり階層化するのは禁止。

- [x] [auth] Lambda: getUserId()ヘルパーのテストと実装 (ADR 0019)
- [x] [auth] Lambda: listHandlerがhostUserIdでフィルタリングする (ADR 0019)
- [x] [auth] Lambda: joinHandlerがhostUserIdをDynamoDBに保存する (ADR 0019)
- [x] [auth] Lambda: getHandlerが他ユーザーのミーティングを403で拒否する (ADR 0019)
- [x] [auth] Lambda: leaveHandlerが他ユーザーのミーティングを403で拒否する (ADR 0019)
- [x] [auth] LocalServer: X-User-Idヘッダーを認証コンテキストに注入する (ADR 0019)
- [x] [auth] CDK: Cognito User Pool + User Pool Client 追加 (ADR 0019)
- [x] [auth] CDK: hostUserId-createdAt-index GSI 追加 (ADR 0019)
- [x] [auth] CDK: JWT Authorizer 追加 (ADR 0019)
- [x] [auth] CDK: 保護対象ルートに authorizationType + authorizerId 追加 (ADR 0019)
- [x] [auth] Frontend: lib/auth.ts 新規作成 (ADR 0019)
- [x] [auth] Frontend: lib/apiFetch.ts 新規作成 (ADR 0019)
- [x] [auth] Frontend: サインインページ作成 (ADR 0019)
- [x] [auth] Frontend: サインアップページ作成 (ADR 0019)
- [x] [auth] Frontend: layout.tsx 未認証時リダイレクト (ADR 0019)
- [x] [auth] Frontend: 各ページのfetch → apiFetch置き換え (ADR 0019)
- [x] [auth] Frontend: .env.example に Cognito 環境変数追記 (ADR 0019)
- [ ] [#185] recallWebhook.ts: `participant_events.chat_message` イベントを受信してSQSに送信
- [ ] [#185] worker.ts: チャットメッセージをDynamoDBに保存し、WindowBufferに追加
- [ ] [#185] WindowBuffer: 音声とチャットをtype付きで管理できるよう拡張
- [ ] [#185] grasp.ts: `{{INPUT:量:voice}}` / `{{INPUT:量:chat}}` / `{{INPUT:量:mix}}` 修飾子を実装（デフォルトはmix）
- [ ] [#185] graspConfigParser.ts: 新しい修飾子フォーマットのバリデーション追加
- [ ] [#195] Timtam自身のチャットを除外する実装（bot.idとparticipant.idの照合、実際のペイロード確認後）
- [ ] E2Eテストでゴールデンパスを動くようにする #43
- [ ] ローカル実行環境を動くようにする #21
- [ ] プロンプトの出力形式を直す #42
- [ ] サードパーティ会議サービスと接続する #45
- [ ] リリースブランチ管理とデプロイ自動化
- [ ] 音声での参加を試す
- [ ] メモの状態をUIで表示（NotesInspectorコンポーネント）
- [ ] IAM リソース絞り込み（Bedrock 推論プロファイル ARN / Polly Voice）
- [ ] ドキュメント更新（README/AGENTS/クライアント側）: `/config` と `/health` の利用方法を追記
- [ ] フロントで音声ON/OFF切替と再生
- [ ] レイテンシ簡易計測（ASR/LLM/TTS）



### Done

 - [x] AWSアカウント作成
 - [x] IAM Idencity CenterでSSO設定、ユーザーとグループ作成
 - [x] AWS CLI設定
 - [x] CloudTrail 有効化
 - [x] Budget作成
 - [x] Cost Anomaly 設定
 - [x] BedrockでAnthropicのモデル利用申請
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
- [x] コンフィグレーションをCDK側に埋め込む
- [x] IAM 権限設定（Chime/Transcribe）
- [x] GET /config エンドポイント実装（公開設定の提供）
- [x] CDK: Orchestrator/TTS の環境変数設定（BEDROCK_REGION / BEDROCK_MODEL_ID / TTS_DEFAULT_VOICE）
- [x] CDK: CloudFormation Outputs 追加（ApiEndpoint/DefaultRegion/DefaultModelId/TtsDefaultVoice）
- [x] ヘルスチェックエンドポイント GET /health 追加
- [x] Web: `/config` を取得して `defaultRegion`/`defaultModelId`/`ttsDefaultVoice` を利用する実装
- [x] CORS 設定（フロントオリジン）
- [x] Orchestrator 環境変数固定（BEDROCK_REGION / BEDROCK_MODEL_ID または 推論プロファイルARN）
- [x] Web クライアント雛形作成（Vite + React）
- [x] Web: Chime SDK クライアントで入室UI（マイクON/OFF・デバイス選択）
- [x] Web/API: POST /meetings で会議作成 → POST /attendees で参加
- [x] Web/API: 文字起こし開始/停止ボタン（/meetings/{id}/transcription/start|stop）
- [x] Web: 既存会議に入室（meetingId 指定）
- [x] Web: マイク無し端末での受信専用入室（スピーカー優先バインド）
- [x] API: /attendees 応答に meeting を含める拡張（既存会議参加用）
- [x] IAM: chime:GetMeeting 許可を追加（既存会議参加時の会議情報取得）
- [x] Web: TranscribeのPartial/Finalを時系列に表示（Finalを窓集約）※クライアント側のみ、サーバー側は Media Pipelines で別途実装必要（ADR 0008参照）
- [x] CORS: 開発用オリジン（http://localhost:5173 / http://127.0.0.1:5173）を許可し早期デプロイ
- [x] /events/transcript エンドポイント実装
- [x] 簡易ルール→Bedrock判定（Haiku 4.5）実装
- [x] /tts エンドポイント実装（Polly）
- [x] Web(S3+CF/CDK): Web 配信用 S3 バケット作成（非公開・OAI/OAC で配信）
- [x] Web(S3+CF/CDK): CloudFront Distribution 作成（HTTPS/SPA フォールバック 403/404→index.html）
- [x] Web(S3+CF/CDK): s3-deployment で `web/timtam-web/dist` を自動デプロイ（無効化付き）
- [x] Web(S3+CF/CDK): CloudFormation Outputs に WebUrl（`https://<distributionDomain>`）を追加
- [x] CORS: API Gateway の allowOrigins に CloudFront オリジンを追加
- [x] Web: `VITE_API_BASE_URL` を ApiEndpoint に設定してフロントをビルド/配信
- [x] ログ最小化（フロント）: デバッグUI/console出力を削除し必要最小に整理
- [x] ログ最小化（サーバ）: Start/Stop の冗長ログ削除、成功/失敗のみ記録
- [x] Web UI ビルドとデプロイ
- [x] Chime Media Pipelines 実装（サーバー側で音声キャプチャ → Transcribe → Kinesis）
- [x] Orchestrator の Kinesis 購読動作確認（Media Pipelines からのデータ受信）
- [x] Lambda ランタイムを Node.js 20 に更新（全関数）
- [x] 介入メッセージを会議チャット欄に表示（自動送出OFF既定）
- [x] DynamoDB に orchestrator-config テーブル作成（CDK: configKey(PK), prompt, updatedAt）
- [x] orchestrator-config テーブルにデフォルトプロンプトを初期化する Lambda 関数作成
- [x] Lambda 関数 getPrompt 作成（GET /orchestrator/prompt で現在のプロンプトを返す）
- [x] Lambda 関数 updatePrompt 作成（PUT /orchestrator/prompt でプロンプト更新、DynamoDB 保存、SQS 送信）
- [x] API Gateway に GET/PUT /orchestrator/prompt ルート追加（CDK）
- [x] updatePrompt に SQS 送信権限付与（CDK）
- [x] getPrompt/updatePrompt に DynamoDB アクセス権限付与（CDK）
- [x] orchestrator worker に CURRENT_PROMPT 変数追加とデフォルト値設定
- [x] orchestrator worker の pollControlOnce を拡張してプロンプトメッセージ処理追加
- [x] orchestrator worker の TriggerLLM.judge メソッドを CURRENT_PROMPT 使用に変更
- [x] orchestrator worker の起動時に DynamoDB から初期プロンプト読み込み処理追加
- [x] orchestrator worker の judge メソッドから policy パラメータ削除
- [x] orchestrator の環境変数に CONFIG_TABLE_NAME と DEFAULT_PROMPT 追加（CDK）
- [x] orchestrator タスクロールに config テーブル読み取り権限追加（CDK）
- [x] Web UI の api.ts に getOrchestratorPrompt と updateOrchestratorPrompt 関数追加
- [x] Web UI の App.tsx にプロンプト設定セクション追加（textarea、保存ボタン、リセットボタン）
- [x] Web UI で起動時に現在のプロンプトを取得して表示
- [x] CDK デプロイして DynamoDB テーブルと Lambda 関数を作成
- [x] orchestrator Docker イメージ再ビルドとデプロイ
- [x] プロンプト更新機能の動作確認（UI → API → SQS → worker → LLM）
- [x] worker.tsでLLM呼び出し時にプロンプトとレスポンスをDynamoDBに保存（type: 'llm_call'）
- [x] App.tsxでLLM呼び出しログを表示するUI追加（折りたたみ可能）
- [x] worker.tsに2つ目のLLM呼び出しを追加（ハードコード、異なるプロンプト）
- [x] 2つのLLMが並列実行されるように実装
- [x] 各LLMの結果をチャットに表示
- [x] App.tsxでLLM呼び出しログを時系列で表示するUI改善
- [x] どのLLMがいつ呼ばれたか区別できるようにする（ノードID表示）
- [x] TemporalNotesStore実装（インメモリKVストア）
- [x] 1つ目のLLMがメモに書き込む処理を追加
- [x] 2つ目のLLMがメモを読んでプロンプトに埋め込む処理を追加
- [x] Grasp設定YAMLファイルを設計
- [x] YAMLパーサーとバリデーション実装（graspConfigParser）
- [x] テンプレート変数フォーマット検証（{{INPUT}}, {{NOTES}}）
- [x] noteTagハンドリングとクロスGraspバリデーション
- [x] worker.tsのGraspConfigなどを新しいものに移行
- [x] Graspのプロンプト生成などのテストを書く
- [x] YAMLからGraspオブジェクトを生成してオーケストレータに適用
- [x] 終了したミーティング関連の情報をメモリ上から除去する
- [x] INPUTのバリエーション処理を実装（latest5, past30m等の動作）
- [x] NOTESのバリエーション処理を実装（tag:all, tag:latest3等の動作）
- [x] Web UIからYAMLを投入してオーケストレータがGrasp構成を置き換えられるようにする
- [x] YAMLでワークフローを設定可能にする

