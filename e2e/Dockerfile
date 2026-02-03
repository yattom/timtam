# E2Eテスト実行用コンテナ
FROM mcr.microsoft.com/playwright:v1.48.2-jammy

WORKDIR /app

# pnpmをインストール
RUN npm install -g pnpm@9

# package.jsonとpackage-lock.jsonをコピー
COPY package.json pnpm-lock.yaml* ./

# 依存関係をインストール
RUN pnpm install --frozen-lockfile

# テストコードをコピー
COPY . .

# デフォルトコマンド（すべてのローカル環境テストを実行）
CMD ["pnpm", "test:local-only"]
