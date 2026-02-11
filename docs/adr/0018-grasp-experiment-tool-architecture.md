# ADR 0018: Grasp設定実験ツールのアーキテクチャ

- Status: Proposed
- Date: 2026-02-11
- Owners: timtam PoC チーム

## 背景 / Context

Grasp設定者（Grasp designer）が実際の会議を開かずにGrasp設定をテスト・実験できるツールが必要。

現状の課題:
- Grasp設定の動作確認には実際の会議が必要で、サイクルが遅い
- Grasp設定者は必ずしも開発者ではないため、ローカルで開発環境を構築して実行することは難しい
- BedrockはAWS実環境が必要なため、完全なローカル実行は困難

## 決定 / Decision

### UIは既存のミーティング詳細ページを流用する

実験ツールはダミーの meetingId を作成し、DynamoDB の `timtam-ai-messages` テーブルに Grasp の実行結果を書き込む。
既存のミーティング詳細ページはこのテーブルをポーリングして表示するため、実験結果の閲覧に転用できる。
`timtam-meetings-metadata` テーブルにも実Recall.ai会議のないダミーエントリを作成することで、既存UIが正常に動作する。

### バックエンドは既存ECSオーケストレーターをリファクタリングして対応する

実験ツール専用の新規実装ではなく、既存のオーケストレーター（ECS Fargate上の `worker.ts`）をリファクタリングして「実験モード」を追加する。
Strategyパターンを用いてリアルタイムモードと実験モードを切り替える。

### タイミング処理の切り替え

リアルタイムモードと実験モードでは時刻の取得方法が異なる:

| | リアルタイムモード | 実験モード |
|---|---|---|
| Graspの個別クールダウン判断 | `Date.now()`（ウォールクロック） | トランスクリプトのタイムスタンプ（仮想時刻） |
| Bedrockスロットリング対応 | Exponential Backoff + Jitter（`ThrottlingException` 発生時のみ待機） | 同左 |

Bedrockスロットリング対応は実時間のスロットリングに対応するものであるため、実験モードでも実時間で待機する。
AWSの推奨に従い、固定クールダウンではなく `ThrottlingException (429)` が返ったときにExponential Backoff + Jitterでリトライする。これにより実験モードでの不要な待機を減らし、実行時間を短縮できる。

### 新規コンポーネント

**新規Lambdaエンドポイント（実験開始API）**:
- 入力: Grasp設定ID（`timtam-grasp-configs` から選択）＋トランスクリプトデータ（タイムスタンプ付きの発話リスト）
- ダミーmeetingIdを生成し `timtam-meetings-metadata` にエントリを作成
- トランスクリプトをオーケストレーターに渡す（SQS経由、または実験モード用の別経路）
- クライアントへ生成したdummymeetingIdを返す（UIがそのまま詳細ページにリダイレクト可能）

**新規UIページ（実験ツールページ）**:
- Grasp設定をドロップダウンで選択
- トランスクリプトをテキストエリアまたはファイルアップロードで入力
- 「実験開始」ボタン → 既存のミーティング詳細ページへ遷移
- 実験結果は既存のミーティング詳細ページで閲覧（再利用）

### アクセス制御について

このツールはBedrockを呼び出すため、利用するたびにコストが発生する。誰でも自由に使えるようにすべきではないが、現状のシステムにはユーザー認証・認可の仕組みがない。アクセス制御の実装は別issueで扱い、本ADRのスコープ外とする。

### 実験ツールの入出力

- **入力**:
  - Grasp設定（既存の `timtam-grasp-configs` DynamoDBテーブルから選択）
  - トランスクリプトデータ（タイムスタンプ付きの発話リスト）
- **出力**:
  - 既存のミーティング詳細ページで閲覧できるAIメッセージ
  - 実験用ダミーミーティングへのリンク

## 影響 / Consequences

**ポジティブ**:
- 新規UIの開発が不要（既存ページを再利用）
- Grasp設定者がブラウザだけで実験を完結できる
- 実験結果の見え方が実際の会議と同じになる

**ネガティブ・リスク**:
- 既存オーケストレーターへの「実験モード」追加は重いリファクタリングが必要
  - `Date.now()` の散在を解消し、Clockを注入可能にする
  - 「10分以上古いメッセージを捨てる」などのリアルタイム前提ロジックを見直す
  - `processWaitingGraspsPeriodically` などのタイマー処理は実験モードでは別動作が必要
- 実験モードではBedrockのスロットリングが発生するとExponential Backoffで待機するため、長いトランスクリプトでは実行時間が長くなる場合がある。Grasp設定者はこれを受け入れる必要がある
- CDKスタックに実験ツール用の新しいLambdaとAPIエンドポイントが必要
- 認証・認可の仕組みがないため、現状では誰でも実験ツールを利用できる（コスト面のリスク）。将来的な対応が必要

## 代替案 / Alternatives Considered

### 低レイヤーのみ共有し、実験ランナーを別実装として新規に書く

`Grasp`・`WindowBuffer`・`Notebook` など低レイヤーのクラスは共有しつつ、実験用の外側ループ（トランスクリプト投入→Grasp発火→結果収集）は新規に書く案。

**却下理由**: コードの重複はないが、実験モードとリアルタイムモードで本質的に同じロジックが別の実装になるリスクがある。オーケストレーターのリファクタリングを通じて一本化する方が長期的に保守しやすいと判断。ただしリファクタリングのコストが高いことは認識している。

## 参考 / References

### 関連ADR
- ADR 0013: Grasp YAML パースとバリデーション
- ADR 0014: ミーティングサービス抽象化レイヤー
- ADR 0015: ミーティングライフサイクルとUIデザイン

### 関連Issue
- Issue #111: Grasp設定の実験ができるようにする

### AWS Bedrockスロットリング関連
- [Quotas for Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/quotas.html) — スロットリングの制限値（TPM/RPM）の説明
- [Troubleshooting Amazon Bedrock API Error Codes](https://docs.aws.amazon.com/bedrock/latest/userguide/troubleshooting-api-error-codes.html) — `ThrottlingException (429)` の説明と対処方法
- [GENOPS02-BP03: Implement solutions to mitigate the risk of system overload](https://docs.aws.amazon.com/wellarchitected/latest/generative-ai-lens/genops02-bp03.html) — Well-Architected Generative AI Lens のベストプラクティス（Exponential Backoff + Jitter等）
