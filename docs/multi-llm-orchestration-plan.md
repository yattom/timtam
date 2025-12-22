# マルチLLMオーケストレーションシステム実装プラン

## 概要

現在の単一プロンプト・オーケストレーターを、YAML設定可能な複数プロンプト対応システムに拡張する。時系列メモ機能とリアルタイムモニタリングUIを追加し、ファシリテーターが柔軟にLLMワークフローを設計できるようにする。

## アーキテクチャの主要決定事項

### 1. システム統合アプローチ
- **方針**: 既存オーケストレーターワーカーを拡張（並行稼働ではなく置き換え）
- **後方互換性**: 既存の単一プロンプトをYAML形式に変換して維持
- **移行戦略**: 機能フラグによる段階的ロールアウト

### 2. データストレージ設計

#### 新規DynamoDBテーブル
- **timtam-orchestrator-workflows**: YAML定義の保存（PK: workflow_id, SK: version）
- **timtam-orchestrator-executions**: 実行履歴・モニタリング用（PK: meetingId#nodeId, SK: timestamp, TTL: 7日）

#### 時系列メモ
- **保存先**: メモリ内（揮発性）
- **実装**: `TemporalNotesStore` クラス（Map<meetingId, Map<key, value>>）
- **TTL**: 会議終了後1時間でクリーンアップ
- **制約**: ECS単一タスク運用（desiredCount=1）で一貫性確保

### 3. YAML設定スキーマ

```yaml
version: "1.0"
name: "workflow-name"

config:
  window_lines: 5
  execution_mode: "sequential"  # or "parallel"

notes:
  # 時系列メモの初期スキーマ定義
  abstraction_level_history: []
  intervention_count: 0

nodes:
  - id: "node-id"
    type: "llm"  # or "logic"
    trigger:
      type: "transcript_update"  # or "note_change", "manual", "timer"
      condition: "final_only"
    llm:
      model_id: "anthropic.claude-haiku-4.5"
      temperature: 0.3
      max_tokens: 300
    prompt:
      template: |
        {{window.content}}
        {{notes.some_key}}
    output:
      format: "json"  # or "text"
      store_to_notes:
        - key: "note_key"
          path: "$.json_path"
          action: "set"  # or "append", "increment"
      publish:
        type: "ai_message"
    cooldown: 5000

edges:
  - from: "node-a"
    to: "node-b"
    condition: "output.field == value"
```

### 4. コアコンポーネント

#### バックエンド（TypeScript）
1. **OrchestratorEngine** - ワークフロー実行エンジン
2. **WorkflowDefinition** - YAML解析・検証・DAG構築
3. **TemporalNotesStore** - インメモリKVストア
4. **NodeExecutor** - ノード実行（LLM, Logic）
5. **TriggerManager** - トリガー評価・クールダウン管理
6. **OutputPublisher** - DynamoDB書き込み・メトリクス送信

#### フロントエンド（React）
1. **OrchestratorMonitor** - リアルタイム実行状況ダッシュボード
   - ExecutionTimeline: ノード実行タイムライン
   - NotesInspector: メモの現在値・変更履歴
   - WorkflowGraph: ワークフローDAGの可視化
   - PerformanceMetrics: レイテンシ・トークン使用量
2. **TranscriptAnalysis** - トランスクリプトと結果の対比ビュー

## 実装ステップ

### Phase 1: インフラ構築
1. 新規DynamoDBテーブル作成（workflows, executions）
   - **変更ファイル**: `/home/yattom/work/timtam/infra/cdk/lib/stack.ts`
2. デフォルトワークフロー（既存プロンプトのYAML変換版）をシード
3. 機能フラグ追加（`use_multi_llm_orchestrator: boolean`）

### Phase 2: コア実装
1. YAML解析・検証
   - **新規ファイル**:
     - `services/orchestrator/WorkflowDefinition.ts`
     - `services/orchestrator/schema.json`
2. 時系列メモストア
   - **新規ファイル**: `services/orchestrator/TemporalNotesStore.ts`
3. ノードエグゼキュータ
   - **新規ファイル**:
     - `services/orchestrator/executors/BaseExecutor.ts`
     - `services/orchestrator/executors/LLMNodeExecutor.ts`
     - `services/orchestrator/executors/LogicNodeExecutor.ts`
4. トリガーマネージャー
   - **新規ファイル**: `services/orchestrator/TriggerManager.ts`
5. オーケストレーターエンジン
   - **新規ファイル**: `services/orchestrator/OrchestratorEngine.ts`

### Phase 3: ワーカー統合
1. worker.tsの拡張
   - **変更ファイル**: `services/orchestrator/worker.ts`
   - 既存TriggerLLMをOrchestratorEngineで置き換え
   - 機能フラグによるデュアルモード運用
2. 単体テスト・統合テスト作成
   - **新規ファイル**: `services/orchestrator/test/*.test.ts`

### Phase 4: API実装
1. ワークフロー管理エンドポイント
   - **新規ファイル**:
     - `services/orchestrator-api/workflows.ts` (GET/PUT/DELETE /orchestrator/workflows)
     - `services/orchestrator-api/executions.ts` (GET /orchestrator/executions/{meetingId})
     - `services/orchestrator-api/notes.ts` (GET /orchestrator/notes/{meetingId})
2. APIルート追加
   - **変更ファイル**: `infra/cdk/lib/stack.ts`

### Phase 5: モニタリングUI
1. コンポーネント作成
   - **新規ファイル**:
     - `web/timtam-web/src/components/OrchestratorMonitor.tsx`
     - `web/timtam-web/src/components/ExecutionTimeline.tsx`
     - `web/timtam-web/src/components/NotesInspector.tsx`
     - `web/timtam-web/src/components/WorkflowGraph.tsx`
     - `web/timtam-web/src/components/PerformanceMetrics.tsx`
2. 既存UIへの統合
   - **変更ファイル**:
     - `web/timtam-web/src/App.tsx` (OrchestratorMonitor組み込み)
     - `web/timtam-web/src/api.ts` (APIクライアント拡張)

### Phase 6: トランスクリプト分析ビュー
1. トランスクリプトAPI
   - **新規ファイル**: `services/meeting-api/transcript.ts` (GET /meetings/{id}/transcript)
2. 分析コンポーネント
   - **新規ファイル**: `web/timtam-web/src/components/TranscriptAnalysis.tsx`

### Phase 7: ドキュメント・サンプル
1. YAMLスキーマドキュメント
   - **新規ファイル**: `docs/workflow-schema.md`
2. サンプルワークフロー
   - **新規ファイル**:
     - `docs/examples/abstraction-monitor.yaml`
     - `docs/examples/groupthink-detector.yaml`
     - `docs/examples/question-counter.yaml`
3. ファシリテーターガイド
   - **新規ファイル**: `docs/facilitator-guide.md`

### Phase 8: デプロイ・ロールアウト
1. CDKデプロイ（インフラ更新）
2. Dockerイメージリビルド（orchestrator）
3. ECSサービス更新
4. Webアプリビルド・デプロイ
5. テストミーティングで段階的有効化

## 主要な技術的決定

### テンプレートエンジン
- **採用**: Handlebars風の構文（`{{variable}}`）
- **理由**: シンプル、サンドボックス化が容易
- **制約**: ループ・条件分岐はlogicノードで対応

### 実行モード
- **デフォルト**: Sequential（トポロジカルソート）
- **オプション**: Parallel（独立ノードを並列実行）
- **設定**: workflow単位でexecution_modeを指定

### LLMレスポンス解析
- **第一優先**: 厳密なJSON形式を期待
- **フォールバック**: Markdownコードブロックから抽出
- **エラーハンドリング**: 失敗時は executions テーブルにログ、リトライ

### UIアップデート
- **Phase 5まで**: ポーリング（1-2秒間隔）
- **将来拡張**: WebSocket（API Gateway経由）

## クリティカルファイル一覧

### 変更が必要なファイル
1. `/home/yattom/work/timtam/services/orchestrator/worker.ts` - マルチLLM対応に拡張
2. `/home/yattom/work/timtam/infra/cdk/lib/stack.ts` - 新規テーブル・API定義
3. `/home/yattom/work/timtam/web/timtam-web/src/App.tsx` - モニタリングUI統合
4. `/home/yattom/work/timtam/web/timtam-web/src/api.ts` - APIクライアント拡張

### 新規作成ファイル（主要）
1. `services/orchestrator/OrchestratorEngine.ts` - コアエンジン
2. `services/orchestrator/WorkflowDefinition.ts` - YAML解析
3. `services/orchestrator/TemporalNotesStore.ts` - メモストア
4. `services/orchestrator/executors/LLMNodeExecutor.ts` - LLMノード実行
5. `web/timtam-web/src/components/OrchestratorMonitor.tsx` - モニタリングUI

## リスクと対策

### リスク1: オーケストレーター再起動でメモ消失
- **対策**: 単一ECSタスク維持、executions テーブルに変更履歴ログ、将来的にRedis移行検討

### リスク2: YAML設定エラーでクラッシュ
- **対策**: アップロード時の厳密な検証、ノード実行のtry-catchサンドボックス、フォールバック機能

### リスク3: LLM APIレート制限
- **対策**: ノード毎のクールダウン、指数バックオフ、CloudWatchメトリクス監視

### リスク4: 複雑ワークフローのレイテンシ
- **対策**: ノード毎タイムアウト（10秒）、並列実行オプション、10ノード超の警告

### リスク5: UIポーリングのオーバーヘッド
- **対策**: `since`パラメータで増分クエリ、ページネーション（limit=50）

## 実装優先順位

### 高優先度
1. シンプルさ優先 - まずLLMノードのみ、Logicノードは後回し
2. モニタリング優先 - 実行ログを先に構築してデバッグしやすく
3. スキーマバージョニング - 将来の拡張に対応
4. エラー境界 - ノード実行を必ずtry-catchでラップ

### 中優先度
5. キャッシング - 解析済みYAMLをメモリキャッシュ
6. メトリクス - CloudWatchにレイテンシ・エラー率・トークン使用量
7. ドキュメント - YAMLスキーマ・サンプルワークフロー

### 将来拡張
8. ビジュアルエディター - ドラッグ&ドロップワークフロー作成
9. ワークフローマーケットプレイス - ユーザー間共有
10. ML駆動トリガー - 会議成果から学習

## 完了条件

1. ✅ YAMLで定義したマルチプロンプトワークフローが動作
2. ✅ 時系列メモがノード間で共有され、閾値判定などが機能
3. ✅ リアルタイムモニタリングUIで各ノードの実行状況・レイテンシが確認可能
4. ✅ トランスクリプトとAI介入結果を並べて確認可能
5. ✅ 既存の単一プロンプトモードも引き続き動作（後方互換）
6. ✅ ファシリテーター向けドキュメント・サンプルが整備
