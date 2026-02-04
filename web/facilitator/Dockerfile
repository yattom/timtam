# Facilitator開発用コンテナ
FROM node:22-slim

WORKDIR /app

# curlをインストール（healthcheck用）
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

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
