# Scripts

このディレクトリには、Timtamプロジェクトで使用する各種スクリプトが含まれている。

## ローカル開発環境

### setup-localstack.sh

LocalStackにDynamoDB、SQS、S3のリソースを作成する。

**使用方法:**

```bash
./scripts/setup-localstack.sh
```

**作成されるリソース:**

- DynamoDBテーブル
- SQSキュー
- S3バケット

**前提条件:**

- LocalStackコンテナが起動していること (`docker-compose up`)
- AWS CLIがインストールされていること

### test-local-dev-env.sh

ローカル開発環境が正しくセットアップされているかテストする。

**使用方法:**

```bash
./scripts/test-local-dev-env.sh
```

**テスト内容:**

1. Dockerデーモンの起動確認
2. LocalStackコンテナの起動確認
3. Recall stubコンテナの起動確認
4. LocalStackヘルスエンドポイントの応答確認
5. Recall stubヘルスエンドポイントの応答確認
6. DynamoDBテーブルの作成確認
7. SQSキューの作成確認
8. S3バケットの作成確認
9. Recall stub API - ボット作成テスト
10. Recall stub API - ボット情報取得テスト
11. Recall stub API - チャットメッセージ送信テスト
12. Recall stub Web UIのアクセス確認

**出力:**

- 全テストがパスした場合: 終了コード `0`
- テストが失敗した場合: 終了コード `1` とエラー詳細

**推奨タイミング:**

- 初回セットアップ後
- 環境に問題がある場合のデバッグ
- PR作成前の最終確認

## デプロイメント

### build-facilitator.sh

Facilitator WebアプリケーションをビルドしてS3にアップロードする準備をする。

**使用方法:**

```bash
./scripts/build-facilitator.sh
```

### deploy-facilitator.sh

Facilitator WebアプリケーションをS3にデプロイし、CloudFrontのキャッシュを無効化する。

**使用方法:**

```bash
./scripts/deploy-facilitator.sh
```

**前提条件:**

- AWSクレデンシャルが設定されていること
- S3バケットとCloudFrontディストリビューションが作成されていること

### deploy-web.sh

Web関連のデプロイメント全般を実行する。

**使用方法:**

```bash
./scripts/deploy-web.sh
```

## スクリプト開発のガイドライン

新しいスクリプトを追加する場合は、以下に従うこと:

1. **Shebang**: `#!/bin/bash` で始める
2. **エラーハンドリング**: `set -e` を使用してエラー時に停止
3. **ヘルプメッセージ**: スクリプトの目的と使用方法をコメントで記載
4. **実行権限**: `chmod +x` で実行可能にする
5. **ドキュメント**: このREADMEに説明を追加

## トラブルシューティング

### Permission denied エラー

```bash
chmod +x scripts/<script-name>.sh
```

### AWS CLI not found

```bash
# macOS
brew install awscli

# Linux
sudo apt-get install awscli

# または
pip install awscli
```

### Docker not found

Docker Desktopをインストールして起動する。
