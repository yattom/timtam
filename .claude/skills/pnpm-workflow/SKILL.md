---
name: pnpm-workflow
description: |
  pnpmワークフローコマンドを実行します。
  本番環境: CDKデプロイ、インフラ管理(open/close)、Webビルド・デプロイ
  ローカル開発環境: LocalStackセットアップ、スキーマ同期、docker-compose操作
  ユーザーがデプロイ、ビルド、インフラ操作、ローカル開発を依頼したときに使用してください。
allowed-tools: Bash
---

# pnpm Workflowスキル

このスキルはプロジェクトのpnpmワークフローコマンドを実行します。

## 環境の選択

このプロジェクトは2つの開発環境をサポートしています：

- **本番環境（AWS）**: 実際のAWSリソースにデプロイ・管理
- **ローカル開発環境（LocalStack）**: 完全にオフラインで動作する開発環境

## 利用可能なコマンドカテゴリ

### 0. ローカル開発環境（LocalStack）

#### sync-schema - CDKスキーマと同期 ⭐ **初回セットアップ必須**
```bash
pnpm run sync-schema
```
CDKからスキーマを抽出してLocalStackに同期。以下を順次実行：
1. `cdk synth` - CloudFormationテンプレート生成
2. `generate-localstack-setup.ts` - AWS CLIスクリプト自動生成
3. `setup-localstack.sh` - LocalStackにリソースを作成（DynamoDB、SQS、S3）

**使用ケース**:
- 初回セットアップ時
- CDKでスキーマ変更後
- LocalStackとCDKのスキーマがずれている時

#### local:setup - LocalStackセットアップ（クイック起動）
```bash
pnpm run local:setup
```
既に生成済みの`setup-localstack.sh`を実行してLocalStackにリソースを作成。

**使用ケース**:
- 日常的な作業開始時（スキーマ変更がない場合）
- docker-compose起動後のリソース作成

**sync-schema vs local:setup**:
- `sync-schema`: CDKから再生成（遅い、スキーマ変更時に使用）
- `local:setup`: 既存スクリプト実行（速い、日常的に使用）

#### local:reset - LocalStack完全リセット
```bash
pnpm run local:reset
```
LocalStackを完全にリセットしてスキーマを再同期。以下を順次実行：
1. `docker-compose down -v` - コンテナとボリューム削除
2. `docker-compose up -d` - 再起動
3. `pnpm run sync-schema` - スキーマ同期

**使用ケース**:
- LocalStackの状態が不整合になった時
- 完全にクリーンな状態から始めたい時
- データを全て削除してやり直したい時

### 1. 統合デプロイ

#### deploy:all - すべてをビルド＆デプロイ ⭐ **推奨**
```bash
pnpm run deploy:all
```
インフラとWebアプリを一括でデプロイする。以下を順次実行：
1. CDKデプロイ（インフラ）
2. Webビルド
3. Webデプロイ

**ユーザーの介入なしで完全なデプロイが完了**します。通常はこのコマンドを使用してください。

### 2. CDK操作

#### cdk:synth - CloudFormationテンプレート生成（デバッグ用）
```bash
pnpm run cdk:synth
```
CDKスタックをCloudFormationテンプレートに変換して確認する。
**注**: `cdk:deploy`は内部で自動的にsynthを実行するため、通常のデプロイでは不要。
デプロイせずにテンプレートだけ確認したい場合や、構文エラーのデバッグ時に使用。

#### cdk:deploy - インフラデプロイ
```bash
pnpm run cdk:deploy
```
CDKスタックをAWSにデプロイする（内部でsynthも実行）。承認なしで自動デプロイ。

#### cdk:destroy - インフラ削除
```bash
pnpm run cdk:destroy
```
デプロイされたCDKスタックを削除する。**慎重に使用**。

#### cdk:diff - 変更差分確認
```bash
pnpm run cdk:diff
```
現在のCDKコードとデプロイ済みスタックの差分を表示。

#### cdk:bootstrap - CDK初期セットアップ
```bash
pnpm run cdk:bootstrap
```
AWS環境でCDKを使用するための初期セットアップ。初回のみ実行。

#### cdk:info - CloudFront情報確認
```bash
pnpm run cdk:info
```
CloudFrontディストリビューションの情報を表示。

### 3. インフラ管理（コスト最適化）

#### infra:close - すべてのインフラを停止
```bash
pnpm run infra:close
```
Lambda、ECS、CloudFrontをすべて停止してコストを削減。

個別に停止する場合:
```bash
pnpm run infra:close:lambda      # Lambda関数の同時実行数を0に
pnpm run infra:close:ecs         # ECSサービスのタスク数を0に
pnpm run infra:close:cloudfront  # CloudFrontを無効化
```

#### infra:open - すべてのインフラを再開
```bash
pnpm run infra:open
```
停止していたLambda、ECS、CloudFrontを再開。

個別に再開する場合:
```bash
pnpm run infra:open:lambda       # Lambda関数の同時実行制限を解除
pnpm run infra:open:ecs          # ECSサービスのタスク数を1に
pnpm run infra:open:cloudfront   # CloudFrontを有効化
```

### 4. Web操作

#### web:build - Webアプリケーションビルド
```bash
pnpm run web:build
```
timtam-webパッケージをビルド。

#### web:deploy - Webアプリケーションデプロイ
```bash
pnpm run web:deploy
```
ビルドしたWebアプリをS3にアップロードしてCloudFrontで配信。

### 5. Orchestratorビルド

#### orchestrator:build - Orchestratorサービスビルド
```bash
pnpm run orchestrator:build
```
orchestratorサービスをビルド。自動的に依存する`@timtam/shared`パッケージも先にビルドされる。

**注**:
- shared パッケージに変更があった場合でも、このコマンド一つで両方ビルドされる
- ビルドが高速なため、毎回 shared を含めてビルドしても問題ない

### 6. テスト

#### test - テスト実行
```bash
pnpm run test
```
orchestratorのテストを実行（Vitest使用）。

**注**:
- 現在、テストはorchestratorサービスにのみ存在します
- `test:watch` と `test:ui` はpackage.jsonに定義されていますが、継続的に実行されるため、Claude Codeでは使用しません（手動実行用）

### 7. その他

#### sso:admin - AWS SSO管理者権限取得 ⚠️ **重要**
```bash
pnpm run sso:admin
```
AWS SSO経由で管理者権限を取得。

**すべてのAWS操作の前に実行が必要**:
- CDK操作（deploy, diff, info等）
- インフラ管理（open/close）
- Web deploy

認証エラーが出た場合は、このコマンドを実行してから再試行する。

#### infra:synth-deploy - 合成とデプロイを一括実行
```bash
pnpm run infra:synth-deploy
```
CDKの合成とデプロイを連続実行。

## 使用シナリオ

### 🏠 ローカル開発環境

#### 初回セットアップ
```bash
# 1. コンテナを起動
docker-compose up -d

# 2. LocalStackが起動するまで待つ（約5-10秒）
sleep 10

# 3. スキーマを同期（DynamoDB、SQS、S3リソースを作成）
pnpm run sync-schema

# 4. 状態確認
docker-compose ps
aws dynamodb list-tables --endpoint-url http://localhost:4566 --region ap-northeast-1
```

#### 日常的な作業開始
```bash
# 1. コンテナを起動（既に起動している場合はスキップ）
docker-compose up -d

# 2. リソースをセットアップ（既存のスクリプトを実行）
pnpm run local:setup

# 3. アプリケーション開発・テストを開始
```

#### スキーマ変更の適用
```bash
# 1. infra/cdk/lib/stack.tsでDynamoDB/SQSスキーマを変更

# 2. スキーマを同期（自動的にCDKと同期）
pnpm run sync-schema

# 3. アプリケーションで動作確認
```

#### トラブルシューティング（完全リセット）
```bash
# LocalStack完全リセット
pnpm run local:reset

# または手動で実行
docker-compose down -v
docker-compose up -d
pnpm run sync-schema
```

#### 作業終了
```bash
# データを保持する場合（推奨）
docker-compose down

# データを完全に削除する場合
docker-compose down -v
```

#### ローカル環境の状態確認
```bash
# コンテナ状態確認
docker-compose ps

# LocalStack health check
curl http://localhost:4566/_localstack/health

# DynamoDBテーブル確認
aws dynamodb list-tables --endpoint-url http://localhost:4566 --region ap-northeast-1

# SQSキュー確認
aws sqs list-queues --endpoint-url http://localhost:4566 --region ap-northeast-1
```

**ローカル環境で作成されるリソース**:
- DynamoDB Tables（5つ）: media-pipelines, ai-messages（TTL設定）, meetings-metadata（GSI）, orchestrator-config（PK: configKey）, grasp-configs
- SQS Queues（3つ）: transcript-asr.fifo（DLQ設定）, transcript-asr-dlq.fifo, OrchestratorControlQueue
- S3 Bucket（1つ）: timtam-local-dev

### 🔐 AWS認証（必須の初回ステップ）

**すべてのワークフローの最初に実行**:
```bash
pnpm run sso:admin
```

このコマンドでAWS管理者権限を取得してから、以降の操作を実行する。

### デプロイの基本フロー

#### 推奨：一括デプロイ
```bash
pnpm run deploy:all
```
インフラとWebアプリを一度にデプロイ。**通常はこれを使用**。

#### 個別デプロイ（トラブルシューティング時）

1. **インフラのみデプロイ**
   ```bash
   pnpm run cdk:deploy
   ```

2. **Webアプリのみビルド・デプロイ**
   ```bash
   pnpm run web:build
   pnpm run web:deploy
   ```

### コスト削減フロー（開発中断時）

```bash
pnpm run infra:close
```

### 開発再開フロー

```bash
pnpm run infra:open
```

## ベストプラクティス

### 本番環境（AWS）

#### デプロイ前の確認
- ✅ `cdk:diff`で変更内容を確認してからデプロイ
- ✅ 本番環境への変更は慎重に
- ✅ CloudFrontの変更は反映に時間がかかることを認識

#### コスト管理
- ✅ 開発を中断する時は`infra:close`でリソースを停止
- ✅ 長期間使わない場合は`cdk:destroy`を検討
- ⚠️ `infra:close:cloudfront`は反映に15-20分かかる

#### トラブルシューティング
- 🔧 デプロイエラーが出たら`cdk:synth`で構文確認
- 🔧 CloudFront情報が必要なら`cdk:info`
- 🔧 AWS認証エラーが出たら`sso:admin`で再認証

### ローカル開発環境（LocalStack）

#### 初回セットアップ
- ✅ `sync-schema`を実行してCDKスキーマと同期
- ✅ LocalStackが完全に起動するまで待つ（約5-10秒）
- ✅ 状態確認コマンドでリソースが正しく作成されたか確認

#### 日常的な開発
- ✅ 作業開始時は`local:setup`で既存スクリプトを実行（高速）
- ✅ スキーマ変更時のみ`sync-schema`を実行（CDKと同期）
- ✅ 作業終了時は`docker-compose down`でリソースを停止（データは保持）

#### スキーマ管理
- ✅ **CDKがSingle Source of Truth** - スキーマ変更は常にCDKで行う
- ✅ `setup-localstack.sh`は自動生成ファイル - 手動編集しない
- ✅ スキーマドリフトを防ぐため、定期的に`sync-schema`を実行

#### トラブルシューティング
- 🔧 LocalStackの状態が不整合 → `local:reset`
- 🔧 スキーマが古い → `sync-schema`
- 🔧 コンテナが起動しない → `docker-compose logs`で確認
- 🔧 リソースが作成されない → LocalStackのhealth checkを確認

#### エラーハンドリング
- ℹ️ LocalStackログの`ResourceInUseException`（400）は正常動作（冪等性のため）
- ℹ️ `|| echo "already exists"`でキャッチされているため無視してOK

## ユーザー依頼例

### 本番環境（AWS）
- 「すべてデプロイして」 → `deploy:all` ⭐ **推奨**
- 「インフラだけデプロイして」 → `cdk:deploy`
- 「Webアプリだけデプロイ」 → `web:build` → `web:deploy`
- 「orchestratorをビルドして」 → `orchestrator:build`
- 「テストを実行して」 → `test`
- 「今日の作業は終了」 → `infra:close`
- 「開発を再開したい」 → `infra:open`
- 「変更内容を確認したい」 → `cdk:diff`
- 「CloudFrontの情報を見せて」 → `cdk:info`
- 「すべて削除したい」 → `cdk:destroy` (**要確認**)

### ローカル開発環境（LocalStack）
- 「ローカル環境をセットアップして」 → `docker-compose up -d` → `sync-schema` ⭐ **初回**
- 「ローカルで作業を始めたい」 → `docker-compose up -d` → `local:setup` ⭐ **日常**
- 「スキーマを変更したから反映して」 → `sync-schema`
- 「LocalStackの状態を確認して」 → `docker-compose ps` + health check
- 「ローカル環境をリセットして」 → `local:reset`
- 「ローカルの作業を終了したい」 → `docker-compose down`
- 「全部削除してクリーンアップ」 → `docker-compose down -v`

## 注意事項

### AWS Profile
すべてのコマンドは`--profile admin`を使用しています。AWS SSO設定が必要です。

### 破壊的な操作
以下のコマンドは元に戻せないので注意:
- `cdk:destroy` - スタック全体を削除
- `infra:close` - リソースを停止（データは保持）

### 実行時間

#### 本番環境（AWS）
- `deploy:all` - 7-12分程度（CDK + Webビルド + デプロイ）
- `cdk:deploy` - 5-10分程度
- `web:deploy` - 1-2分程度
- `infra:close:cloudfront` / `infra:open:cloudfront` - 15-20分程度

#### ローカル開発環境（LocalStack）
- `docker-compose up -d` - 5-10秒
- `sync-schema` - 20-30秒（CDK synth + スクリプト生成 + LocalStack作成）
- `local:setup` - 5秒（既存スクリプト実行のみ）
- `local:reset` - 30-40秒（削除 + 起動 + スキーマ同期）

### データの永続性（ローカル開発環境）
- `docker-compose down`: データは保持される（`localstack-data`ボリューム）
- `docker-compose down -v`: **すべてのデータが削除される**

### AWS CLI Endpoint（ローカル開発環境）
ローカル開発時は必ず`--endpoint-url http://localhost:4566`を指定：
```bash
# 正しい
aws dynamodb list-tables --endpoint-url http://localhost:4566 --region ap-northeast-1

# 間違い（本番AWSに接続してしまう）
aws dynamodb list-tables --region ap-northeast-1
```

## コマンド実行時の注意

1. **AWS認証の確認**: AWS操作の前に必ず `pnpm run sso:admin` で認証されていることを確認。認証エラーが出た場合は、まず `sso:admin` を実行してから再試行
2. **エラーハンドリング**: コマンド失敗時は出力を確認してユーザーに報告
3. **進捗報告**: 長時間かかるコマンドは実行中であることをユーザーに伝える
4. **確認**: 破壊的な操作は実行前にユーザーに確認を求める
5. **日本語出力**: 実行結果は日本語で要約してユーザーに報告

## パス・環境情報

### 本番環境（AWS）
- ワーキングディレクトリ: `/home/yattom/work/timtam/branches/wt1`
- AWS Profile: `admin`
- AWS Region: `ap-northeast-1`
- インフラパッケージ: `timtam-infra`
- Webパッケージ: `timtam-web`
- Orchestratorサービス: `services/orchestrator`
- Sharedパッケージ: `packages/shared`

### ローカル開発環境（LocalStack）
- ワーキングディレクトリ: `/home/yattom/work/timtam/branches/wt1`
- LocalStack Endpoint: `http://localhost:4566`
- Recall.ai Stub Endpoint: `http://localhost:8080`
- AWS Region: `ap-northeast-1`
- docker-compose file: `./docker-compose.yml`
- セットアップスクリプト: `./scripts/setup-localstack.sh`（自動生成）
- スキーマ同期スクリプト: `./scripts/sync-localstack-schema.sh`
- スキーマ生成スクリプト: `./scripts/generate-localstack-setup.ts`

## 関連ドキュメント

- [README.md](../../README.md) - プロジェクト概要
- [docs/local-development.md](../../docs/local-development.md) - ローカル開発環境詳細ガイド
- [docs/adr/0016-local-development-environment-recall-stub.md](../../docs/adr/0016-local-development-environment-recall-stub.md) - ADR 0016

