# Phase 3: Facilitator UI デプロイガイド

## 概要

Phase 3でFacilitator UI（ファシリテーター向け管理画面）を実装した。このガイドではデプロイ手順を説明する。

## URL構造

ADR 0015に基づいて、以下のURL構造を実装した：

- **`/`** - Facilitator UI（管理者向け）
- **`/<meetingCode>/attendee`** - Attendee UI（Phase 4で実装予定）

## CloudFront設定

CloudFront Functionsを使用して、リクエストURLに基づいてS3バケット内の適切なファイルを返す：

### ルートパス (`/`)
- `facilitator/index.html`を返す
- Next.jsのSPAルーティングに対応

## デプロイ手順

### 1. Facilitator UIのビルド

```bash
cd web/facilitator
pnpm install
pnpm build
```

ビルド成果物は`out/`ディレクトリに生成される。

### 2. S3へのアップロード

```bash
# S3バケット名を取得
BUCKET_NAME=$(aws cloudformation describe-stacks \
  --stack-name TimtamInfraStack \
  --query 'Stacks[0].Outputs[?OutputKey==`WebSiteBucketName`].OutputValue' \
  --output text)

# Facilitator UIをアップロード
aws s3 sync web/facilitator/out/ s3://${BUCKET_NAME}/facilitator/ \
  --delete \
  --cache-control "public, max-age=31536000, immutable" \
  --exclude "index.html"

# index.htmlは別途アップロード（キャッシュ無効化）
aws s3 cp web/facilitator/out/index.html s3://${BUCKET_NAME}/facilitator/index.html \
  --cache-control "public, max-age=0, must-revalidate"
```

### 3. CloudFrontキャッシュの無効化

```bash
# Distribution IDを取得
DISTRIBUTION_ID=$(aws cloudformation describe-stacks \
  --stack-name TimtamInfraStack \
  --query 'Stacks[0].Outputs[?OutputKey==`WebDistributionId`].OutputValue' \
  --output text)

# キャッシュ無効化
aws cloudfront create-invalidation \
  --distribution-id ${DISTRIBUTION_ID} \
  --paths "/*"
```

### 4. 環境変数の設定

Facilitator UIからAPIを呼び出すために、環境変数を設定する：

```bash
# .env.productionを作成
cd web/facilitator
cat > .env.production <<EOF
NEXT_PUBLIC_API_URL=https://your-api-gateway-url.execute-api.ap-northeast-1.amazonaws.com
EOF

# 再ビルドしてデプロイ
pnpm build
# 再度S3にアップロード（手順2を繰り返し）
```

API Gateway URLは以下のコマンドで取得できる：

```bash
aws cloudformation describe-stacks \
  --stack-name TimtamInfraStack \
  --query 'Stacks[0].Outputs[?OutputKey==`HttpApiUrl`].OutputValue' \
  --output text
```

## 動作確認

### 1. CloudFront URLを取得

```bash
aws cloudformation describe-stacks \
  --stack-name TimtamInfraStack \
  --query 'Stacks[0].Outputs[?OutputKey==`WebUrl`].OutputValue' \
  --output text
```

### 2. ブラウザでアクセス

- **Facilitator UI**: `https://d1234567890.cloudfront.net/`

### 3. 機能確認

1. ダッシュボードが表示される
2. 「新しい会議に参加」ボタンから会議参加フォームにアクセスできる
3. Grasp設定ページでYAML編集ができる

## トラブルシューティング

### 403/404エラー

CloudFront Functionのリライトルールが正しく動作しているか確認：

```bash
# CloudFront Functionのログを確認
aws cloudfront get-function \
  --name TimtamInfraStack-FacilitatorRewrite... \
  --stage LIVE
```

### APIエラー

CORS設定を確認：

```bash
# API GatewayのCORS設定を確認
aws apigatewayv2 get-api \
  --api-id $(aws cloudformation describe-stacks --stack-name TimtamInfraStack --query 'Stacks[0].Outputs[?OutputKey==`HttpApiId`].OutputValue' --output text)
```

CloudFrontドメインが`allowOrigins`に含まれているか確認。

### キャッシュ問題

ブラウザのハードリフレッシュ（Ctrl+Shift+R / Cmd+Shift+R）を試す。

または、CloudFrontキャッシュを無効化：

```bash
aws cloudfront create-invalidation \
  --distribution-id ${DISTRIBUTION_ID} \
  --paths "/*"
```

## CI/CD統合

GitHub Actionsでの自動デプロイ例：

```yaml
name: Deploy Facilitator UI

on:
  push:
    branches:
      - main
    paths:
      - 'web/facilitator/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: |
          cd web/facilitator
          pnpm install

      - name: Build
        run: |
          cd web/facilitator
          pnpm build
        env:
          NEXT_PUBLIC_API_URL: ${{ secrets.API_URL }}

      - name: Deploy to S3
        run: |
          aws s3 sync web/facilitator/out/ s3://${{ secrets.S3_BUCKET }}/facilitator/ \
            --delete \
            --cache-control "public, max-age=31536000, immutable" \
            --exclude "index.html"

          aws s3 cp web/facilitator/out/index.html \
            s3://${{ secrets.S3_BUCKET }}/facilitator/index.html \
            --cache-control "public, max-age=0, must-revalidate"
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          AWS_DEFAULT_REGION: ap-northeast-1

      - name: Invalidate CloudFront
        run: |
          aws cloudfront create-invalidation \
            --distribution-id ${{ secrets.CLOUDFRONT_DISTRIBUTION_ID }} \
            --paths "/*"
```

## 次のステップ

Phase 3完了後、Phase 4でAttendee UI（参加者向け）を実装する。
