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

### 基本的な実行

```bash
npm test
```

### ヘッド付きモードで実行（ブラウザを表示）

```bash
npm run test:headed
```

### UIモードで実行（インタラクティブ）

```bash
npm run test:ui
```

### デバッグモード

```bash
npm run test:debug
```

## 環境変数

テストは以下の環境変数で設定できます：

- `BASE_URL`: テスト対象のURL（デフォルト: `http://localhost:5173`）

例：

```bash
BASE_URL=https://your-timtam-deployment.com npm test
```

## テストケース

### golden-path.spec.ts

会議の基本的なゴールデンパステストを実行します：

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
