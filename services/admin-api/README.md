# Admin API

管理用APIエンドポイント。AWSコスト削減と悪意ある第三者のアクセスを防ぐために、CloudFrontとLambdaを必要に応じてdisable/enableする。

## エンドポイント

### POST /admin/close/{password}

すべてのインフラストラクチャを停止する:
- すべてのLambda関数を無効化(管理用Lambda以外)
- ECSサービスのdesired countを0に設定
- CloudFrontディストリビューションを無効化

**レスポンス:**
```json
{
  "result": "OK"
}
```

### POST /admin/open/{password}

すべてのインフラストラクチャを再開する:
- すべてのLambda関数を有効化
- ECSサービスのdesired countを1に設定
- CloudFrontディストリビューションを有効化

**レスポンス:**
```json
{
  "result": "OK"
}
```

## デプロイ方法

環境変数 `ADMIN_PASSWORD` を設定してからデプロイする:

```bash
export ADMIN_PASSWORD="your-secret-password"
pnpm cdk:deploy
```

または、CDK contextを使用:

```bash
pnpm cdk deploy --context adminPassword=your-secret-password
```

## 使用例

```bash
# インフラを停止
curl https://<api-base-url>/admin/close/your-secret-password

# インフラを再開
curl https://<api-base-url>/admin/open/your-secret-password
```

## セキュリティ

- パスワードはURLパスに含まれるため、HTTPS必須
- パスワードが一致しない場合は403エラーを返す
- 管理用Lambda自体は常にenableのまま
