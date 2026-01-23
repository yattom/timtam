# Timtam Facilitator UI

会議ファシリテーター向けの管理画面。

## 機能

### ボット管理
- Zoom/Google Meet/Microsoft Teams/Webexの会議にボットを参加させる
- ボット状態のモニタリング
- ボット退出

### Grasp設定
- YAML形式でGrasp設定を編集
- リアルタイム適用

### モニタリング
- リアルタイム文字起こし表示
- AI応答の確認
- LLM呼び出しログの詳細表示

## セットアップ

```bash
# 依存関係のインストール
pnpm install

# 環境変数設定
cp .env.example .env
# .envを編集してNEXT_PUBLIC_API_URLを設定

# 開発サーバー起動
pnpm dev
```

## ビルド・デプロイ

```bash
# 静的エクスポート
pnpm build

# outディレクトリがS3にデプロイされる
# CloudFrontのルートパス(/)で配信
```

## URL構造

- `/` - ダッシュボード
- `/meetings/join` - 会議参加フォーム
- `/meetings/[id]` - 会議詳細・モニタリング
- `/config` - Grasp設定
