# Facilitator開発用コンテナ
FROM node:22-slim

WORKDIR /app

# pnpmをインストール
RUN npm install -g pnpm@9

# package.jsonをコピー（依存関係のインストール用）
COPY package.json ./

# 依存関係をインストール
RUN pnpm install

# ポート3001を公開
EXPOSE 3001

# デフォルトコマンド（開発サーバー起動）
CMD ["pnpm", "dev"]
