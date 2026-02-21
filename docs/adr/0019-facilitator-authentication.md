# ADR 0019: ファシリテーター認証 - AWS Cognito User Pool

- Status: Proposed
- Date: 2026-02-21
- Owners: timtam PoC チーム

## 背景 / Context

PoC段階では全ユーザーが全ミーティングデータを参照・操作できる状態だった。ベータユーザー招待に向けて、各ユーザーが自分のミーティングのみアクセスできるようにする必要がある。

当初はAWS Cognito Identity Poolによるゲスト（匿名）認証を検討していたが、ゲスト認証ではユーザーIDがデバイス・ブラウザ依存となり、ブラウザデータのクリア時にアクセスが失われる問題がある。ベータユーザーには明示的なアカウント登録を求める方針に変更する。

## 決定 / Decision

- AWS Cognito User Poolを使って、ファシリテーターのユーザー登録・ログインを行う
- ファシリテーターはサインアップ・サインインを完了しないとミーティングを開始できない
- 匿名（ゲスト）アクセスは許可しない
- Attendee向けページへのアクセスは当面対応しない
- API GatewayにCognito JWT Authorizerを設定し、Lambdaの実行前に認証を確認する。未認証リクエストはLambdaに到達せず401を返す
- LambdaはCognito APIを直接呼ばず、`event.requestContext.authorizer.claims.sub`からユーザーIDを取得する
- DynamoDBのミーティングメタデータ（`timtam-meetings-metadata`）に`hostUserId`フィールドを追加してホストを管理する
- ユーザー別のミーティング一覧取得のため`hostUserId-createdAt-index` GSIを追加する
- ローカル開発環境ではCognitoを使わない。Express ServerがフロントエンドのユーザーIDをAPI Gatewayのauthorizerクレーム形式（`requestContext.authorizer.claims`）に変換してLambdaに渡す
- 既存データへの`hostUserId`追加は別途マイグレーションで対応する

### 認証不要エンドポイント（除外対象）

以下は認証対象外とする：

- `POST /recall/webhook` - Recall.aiからのコールバック（別途webhook認証を検討）
- `GET /health`, `GET /config` - 公開ヘルスチェック・設定

### ローカル開発環境の設計

```
フロントエンド（ローカル）
  → X-User-Id: <ランダムID> ヘッダーを付与してリクエスト

Express Server（local-api-server）
  → requestContext.authorizer.claims.sub にユーザーIDを設定してLambdaを呼び出す

Lambda
  → event.requestContext.authorizer.claims.sub からユーザーIDを取得（本番と同じコード）
```

## 影響 / Consequences

- 既存のAPIエンドポイント（除外対象を除く）にJWT認証が必要になる
- フロントエンドにサインアップ・サインイン画面が必要になる
- DynamoDBのスキーマ変更（`hostUserId`フィールド追加、GSI追加）
- CDKスタックにCognito User Pool・JWT Authorizerの追加が必要
- ローカル開発環境のExpress Serverに認証コンテキスト注入処理が必要
- Lambda実装でCognito APIを呼ばないため、Lambdaのコードは本番・ローカルで共通にできる

## 代替案 / Alternatives Considered

- **Cognito Identity Pool（ゲスト認証）**: 当初案。ユーザー登録不要で簡便だが、ユーザーIDがデバイス・ブラウザ依存となりブラウザデータ削除時にアクセスが失われる問題がある。ベータ利用での信頼性に欠けるため却下
- **独自認証（自前実装）**: 実装コストが高く、セキュリティリスクが高いため却下

## 未決事項 / TBD

- Attendee向け認証（将来的に対応予定）
- 既存データへの`hostUserId`移行タイミングと手順
- サインアップ時のメール確認フロー・UIデザイン
- パスワードリセットフローのUI
- Recall.ai webhookの認証方式（署名検証・IPホワイトリスト等）

## 参考 / References

- Issue #123: ユーザーを識別する
- AWS Cognito User Pools ドキュメント
- API Gateway JWT Authorizer ドキュメント

### 関連ADR

- ADR 0001: セキュリティと同意・プライバシー方針（PoC）
- ADR 0012: ローカル開発環境
- ADR 0015: 会議ライフサイクルとUI設計
