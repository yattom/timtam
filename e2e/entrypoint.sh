#!/bin/bash
set -e

# localhost:3000 を api-server:3000 にリダイレクト
# これにより、e2e-testsコンテナ内のブラウザが localhost:3000 にアクセスすると
# api-server:3000 に転送される
echo "Starting port forwarding: localhost:3000 -> api-server:3000"
socat TCP-LISTEN:3000,fork,reuseaddr TCP:api-server:3000 &

# 渡されたコマンドを実行
exec "$@"
