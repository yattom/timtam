#!/bin/bash
set -e

# localhost:3000 を api-server:3000 にリダイレクト
# これにより、e2e-testsコンテナ内のブラウザが localhost:3000 にアクセスすると
# api-server:3000 に転送される
echo "Starting port forwarding: localhost:3000 -> api-server:3000"
socat TCP-LISTEN:3000,fork,reuseaddr TCP:api-server:3000 &

# localhost:4566 を localstack:4566 にリダイレクト
# invokeタスクがLocalStackにアクセスできるようにする
echo "Starting port forwarding: localhost:4566 -> localstack:4566"
socat TCP-LISTEN:4566,fork,reuseaddr TCP:localstack:4566 &

# Python invoke タスク用のシンボリックリンクを作成
# docker-compose.ymlのボリュームマウントで上書きされるため、起動時に作成
ln -sf /root/tasks.py /app/tasks.py
ln -sf /root/invoke_tasks /app/invoke_tasks

# 渡されたコマンドを実行
exec "$@"
