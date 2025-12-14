# ADR 0007: オーケストレータとブラウザ間の双方向通信

- Status: TBD
- Date: 2025-12-14
- Owners: timtam PoC チーム

## 背景 / Context

会議中のユーザーは、ブラウザからオーケストレータに対して以下のような操作を行う必要がある：
- プロンプトの調整（LLMへの指示変更）
- 介入の一時停止・再開
- 手動介入リクエスト（明示的に発言を求める）
- 現在の設定・状態の取得

オーケストレータは会議ごとにECS Fargateタスクとして起動し、Kinesis/EventBridgeからのイベントをプルする非同期ループで動作する（ADR 0002参照）。この設計において、ブラウザからオーケストレータへのリクエストをどう実装するかを検討する。

## 検討した選択肢 / Options Considered

### Option 1: API Gateway → Lambda → DynamoDB経由で状態共有

```
ブラウザ → API Gateway → Lambda → DynamoDB (会議設定テーブル)
                                      ↑
                          ECS Fargate (定期ポーリング or DynamoDB Streams)
```

**メリット**:
- 既存のAPI Gateway/Lambda構成を拡張するだけ
- オーケストレータへの直接HTTP接続不要
- シンプルな実装

**デメリット**:
- リアルタイム性が低い（ポーリング間隔またはStreams遅延）
- 設定変更の反映に数秒の遅延

---

### Option 2: Application Load Balancer + ECS Fargate (HTTP API)

```
ブラウザ → API Gateway (or 直接ALB) → ALB → ECS Fargate タスク
                                              (HTTP API実装)
```

オーケストレータがHTTPエンドポイントを持ち、バックグラウンドループと並行してHTTPリクエストを処理。

**ルーティング方法**:
- ALBターゲットグループへの動的登録/解除
- AWS Cloud Map (Service Discovery) で meetingId → エンドポイント解決

**メリット**:
- リアルタイム反映（即座に設定変更）
- RESTful APIで直感的

**デメリット**:
- ALBの動的ルーティング設定が複雑
- タスクの登録/解除管理が必要

---

### Option 3: WebSocket API (API Gateway WebSocket)

```
ブラウザ ↔ API Gateway WebSocket ↔ Lambda ↔ SQS/SNS
                                              ↓
                                        ECS Fargate
```

**メリット**:
- 双方向リアルタイム通信
- オーケストレータ → ブラウザへのプッシュ通知も可能
- 設定変更の即時反映

**デメリット**:
- 実装が最も複雑
- WebSocket接続管理のコスト

---

### Option 4: API Gateway → Lambda → Redis/ElastiCache経由

```
ブラウザ → API Gateway → Lambda → Redis/ElastiCache
                                      ↑ (Pub/Sub or peek)
                                ECS Fargate (イベントループ)
```

**メリット**:
- 低レイテンシ（数ms）
- 非ブロッキングpeekでイベントループと相性良い
- 会議終了時にキュー削除でクリーンアップ簡単
- Redis Pub/Subで即時通知可能

**デメリット**:
- Redis/ElastiCacheの追加コスト・管理
- 他要件でDynamoDBを使う場合、ストレージが分散

---

## 決定 / Decision

**TBD（未決定）**

以下の点を考慮して後続フェーズで決定する：

1. **設定変更の反映速度要件**
   - 数秒遅延が許容できるか
   - 即時反映（サブ秒）が必要か

2. **オーケストレータ → ブラウザへの通知要件**
   - 「介入しました」等の通知が必要か
   - 必要な場合、WebSocketまたはポーリングか

3. **他機能でのストレージ要件**
   - DynamoDBを他の用途（会話履歴、セッション管理等）で使用するか
   - 使用する場合、Option 1でDynamoDBに統一する方がシンプル
   - 使用しない場合、Option 4 (Redis) がイベントループと相性良い

4. **PoC優先度**
   - Phase 1（最小PoC）: Option 1推奨（既存構成活用、実装簡単）
   - Phase 2（改善）: Option 4 (Redis) or Option 2 (ALB)
   - Phase 3（本格化）: Option 3 (WebSocket)

## 技術的考察 / Technical Notes

### Redis vs DynamoDB for Orchestrator State

**Redis の利点**:
- 非ブロッキング peek でイベントループと自然に統合
- キュー操作が軽量（LPUSH/RPOP）
- 会議終了時に DEL で即座にクリーンアップ
- Pub/Sub で即時通知可能

**DynamoDB の利点**:
- サーバーレス（管理不要）
- 他機能（会話履歴、RAG、セッション等）と統合しやすい
- ストレージの一元化

### 段階的実装の推奨

1. **Phase 1**: Option 1 (DynamoDB) で最小実装
2. リアルタイム性が課題になったら Option 4 (Redis) または Option 2 (ALB) に移行
3. 双方向通知が重要になったら Option 3 (WebSocket) に拡張

## 影響 / Consequences

- 決定まで、ブラウザからの操作は実装しない、または仮実装（DynamoDB）で進める
- Redis採用の場合、ElastiCacheのコストとメンテナンスが追加される
- DynamoDB採用の場合、将来的にリアルタイム性向上のためDynamoDB Streamsまたは別手段への移行が必要になる可能性

## 未決事項 / TBD

- [ ] 設定変更の反映速度要件の明確化（ユーザーテストで確認）
- [ ] DynamoDBを会話履歴・セッション管理等で使用するかの決定
- [ ] オーケストレータからブラウザへの通知要件の明確化
- [ ] Phase 1での仮実装方式の選定

## 参考 / References

- ADR 0002: リアルタイム性（オーケストレーション: ECS Fargate常駐ワーカー）
- AWS ElastiCache for Redis ドキュメント
- DynamoDB Streams ドキュメント
- API Gateway WebSocket API ドキュメント
