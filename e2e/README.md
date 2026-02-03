# timtam E2Eテスト

このディレクトリには、timtam会議システムのEnd-to-End（E2E）自動テストが含まれています。

## 概要

E2Eテストは、Playwrightを使用してTypescriptで実装されています。デプロイされたシステム全体が正しく動作していることを確認します。

## 前提条件

- Node.js (v18以上推奨)
- npm または pnpm
- デプロイ済みのtimtamシステム、またはローカルで実行中のシステム

## セットアップ

1. 依存関係をインストール：

```bash
cd e2e
npm install
```

2. Playwrightブラウザをインストール：

```bash
npx playwright install chromium
```

## テストの実行

### Docker環境での実行（推奨）

ローカル環境用のE2Eテストは、`docker compose`を使って実行することを推奨します。この方法では、依存関係やブラウザのインストールが不要です。

```bash
# ローカル環境用テスト全体を実行
docker compose run --rm e2e-tests

# 特定のテストファイルを実行
docker compose run --rm e2e-tests pnpm test -- local-sanity.spec.ts

# ローカル環境用テストのみ実行（@localタグ）
docker compose run --rm e2e-tests pnpm test:local-only

# AWS環境用テストのみ実行（@awsタグ）
docker compose run --rm e2e-tests pnpm test:aws-only
```

**注意**: facilitatorもコンテナ化されているため、`docker compose up -d`で起動しておく必要があります。

### ホスト側での実行

従来通り、ホスト側で直接実行することもできます：

```bash
# 基本的な実行
pnpm test

# ローカル環境用テストのみ
pnpm test:local-only

# AWS環境用テストのみ
pnpm test:aws-only
```

### ヘッド付きモードで実行（ブラウザを表示）

```bash
pnpm run test:headed
```

### UIモードで実行（インタラクティブ）

```bash
pnpm run test:ui
```

### デバッグモード

```bash
pnpm run test:debug
```

## 環境変数

テストは以下の環境変数で設定できます：

- `BASE_URL`: テスト対象のURL（デフォルト: `http://localhost:5173`）

例：

```bash
BASE_URL=https://your-timtam-deployment.com npm test
```

## テストタグ

テストは環境別にタグ付けされています：

- `@local`: ローカル環境用テスト（LocalStack + Recall Stub使用）
- `@aws`: AWS環境用テスト（Chime SDK等の本番サービス使用）

タグを使ったテスト実行：
```bash
# ローカル環境用テストのみ実行
pnpm test:local-only  # または: pnpm test -- --grep @local

# AWS環境用テストのみ実行
pnpm test:aws-only    # または: pnpm test -- --grep @aws
```

## テストケース

### local-sanity.spec.ts (タグ: @local)

ローカル開発環境のサニティチェックテストです：

**前提条件（Docker環境）：**
- `docker compose up -d` ですべてのサービス（facilitator含む）が起動している
- `pnpm run local:setup` でLocalStackリソースが作成されている

**前提条件（ホスト実行）：**
- `docker-compose up -d` でバックエンドサービスが起動している
- `pnpm run local:setup` でLocalStackリソースが作成されている
- `web/facilitator` で `pnpm run dev` が起動している（ポート3001）

**テスト内容：**
1. Facilitator UIにアクセス（http://localhost:5173）
2. エラーが表示されないことを確認
3. 新しいミーティングを開始
4. stub-recallai（http://localhost:8080）でミーティングが表示されることを確認
5. stub-recallaiから文字起こしテキストを送信
6. Facilitator UIに文字起こしが表示されることを確認
7. 会議を終了

**実行方法：**
```bash
# Docker環境
docker compose run --rm e2e-tests pnpm test -- local-sanity.spec.ts

# ホスト側
cd e2e
pnpm test -- local-sanity.spec.ts
```

**環境変数：**
- `FACILITATOR_URL`: Facilitator UIのURL（デフォルト: `http://localhost:3001`）
- `STUB_RECALL_URL`: stub-recallaiのURL（デフォルト: `http://localhost:8080`）

### golden-path.spec.ts (タグ: @aws)

会議の基本的なゴールデンパステストを実行します（AWS本番環境用）：

1. ページを開く
2. 自分の名前を設定する
3. GraspYAMLを設定する
4. 会議を開始する
5. 別ブラウザ、別セッションで同じ会議に参加する
6. 両方のブラウザから30秒ほど音声を入力する
7. 文字起こしがされることを確認する
8. AIアシスタントが反応することを確認する
9. 会議を終了する

## 音声入力について

Playwrightのフェイクメディアストリーム機能を使用しています。
`--use-fake-device-for-media-stream`フラグにより、実際の音声ファイルなしで音声入力をシミュレートできます。

## トラブルシューティング

### ブラウザがインストールされていない

```bash
npx playwright install chromium
```

### タイムアウトエラー

テストは長時間実行される場合があります（最大3分）。
ネットワークの遅延やシステムの応答時間によっては、タイムアウトが発生する可能性があります。

### 文字起こしやAI反応が確認できない

- バックエンドサービス（Orchestrator、Meeting API等）が正しく動作していることを確認してください
- Amazon Chime SDKの文字起こし機能が有効になっていることを確認してください
- Grasp設定が正しく保存されていることを確認してください

## レポート

テスト実行後、`playwright-report/`ディレクトリにHTMLレポートが生成されます：

```bash
npx playwright show-report
```

## CI/CD統合

GitHub ActionsやAWS CodePipelineなどのCI/CDパイプラインでテストを実行するには：

```yaml
- name: Run E2E tests
  run: |
    cd e2e
    npm ci
    npx playwright install --with-deps chromium
    BASE_URL=https://your-deployment.com npm test
```
