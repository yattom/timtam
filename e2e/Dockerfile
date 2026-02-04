# E2Eテスト実行用コンテナ
FROM mcr.microsoft.com/playwright:v1.48.2-jammy

WORKDIR /app

# socat をインストール（localhost:3000 を api-server:3000 にリダイレクトするため）
RUN apt-get update && apt-get install -y socat curl && rm -rf /var/lib/apt/lists/*

# uv をインストール（Pythonタスクランナー用）
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"

# pnpmをインストール
RUN npm install -g pnpm@9

# package.json をコピー
COPY package.json ./

# 依存関係をインストール（pnpm-lock.yamlなしで）
RUN pnpm install

# entrypoint スクリプトをコピー
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# テストコードをコピー
COPY . .

# entrypoint を設定
ENTRYPOINT ["/entrypoint.sh"]

# デフォルトコマンド（すべてのローカル環境テストを実行）
CMD ["pnpm", "test:local-only"]
