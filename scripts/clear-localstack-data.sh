#!/bin/bash
# LocalStackのDynamoDBテーブルとSQSキューのデータをクリア
# テーブル自体は削除せず、データだけを削除する

set -e

ENDPOINT="http://localhost:4566"
REGION="ap-northeast-1"

echo "========================================="
echo "Clearing LocalStack data..."
echo "========================================="

# DynamoDBテーブルのデータを削除
clear_table_data() {
  local table_name=$1
  local hash_key=$2
  local range_key=$3

  echo "Clearing $table_name..."

  # テーブルをスキャンして全アイテムを取得
  items=$(aws dynamodb scan \
    --endpoint-url "$ENDPOINT" \
    --region "$REGION" \
    --table-name "$table_name" \
    --query 'Items' \
    --output json 2>/dev/null || echo '[]')

  # アイテム数を確認
  count=$(echo "$items" | jq 'length')

  if [ "$count" -eq 0 ]; then
    echo "  → $table_name is already empty"
    return
  fi

  echo "  → Deleting $count item(s) from $table_name..."

  # 各アイテムを削除
  if [ -z "$range_key" ]; then
    # Hash key only
    echo "$items" | jq -c '.[]' | while read -r item; do
      key=$(echo "$item" | jq -c "{\"$hash_key\": .\"$hash_key\"}")
      aws dynamodb delete-item \
        --endpoint-url "$ENDPOINT" \
        --region "$REGION" \
        --table-name "$table_name" \
        --key "$key" \
        > /dev/null 2>&1
    done
  else
    # Hash key + Range key
    echo "$items" | jq -c '.[]' | while read -r item; do
      key=$(echo "$item" | jq -c "{\"$hash_key\": .\"$hash_key\", \"$range_key\": .\"$range_key\"}")
      aws dynamodb delete-item \
        --endpoint-url "$ENDPOINT" \
        --region "$REGION" \
        --table-name "$table_name" \
        --key "$key" \
        > /dev/null 2>&1
    done
  fi

  echo "  ✓ $table_name cleared"
}

# 各テーブルのデータをクリア
clear_table_data "timtam-ai-messages" "meetingId" "timestamp"
clear_table_data "timtam-meetings-metadata" "meetingId" ""
clear_table_data "timtam-orchestrator-config" "configKey" ""
clear_table_data "timtam-grasp-configs" "configId" ""

echo ""

# SQSキューをパージ
echo "Purging SQS queues..."

aws sqs purge-queue \
  --endpoint-url "$ENDPOINT" \
  --region "$REGION" \
  --queue-url "http://localhost:4566/000000000000/transcript-asr.fifo" \
  2>/dev/null && echo "  ✓ transcript-asr.fifo purged" || echo "  → transcript-asr.fifo is empty or does not exist"

aws sqs purge-queue \
  --endpoint-url "$ENDPOINT" \
  --region "$REGION" \
  --queue-url "http://localhost:4566/000000000000/transcript-asr-dlq.fifo" \
  2>/dev/null && echo "  ✓ transcript-asr-dlq.fifo purged" || echo "  → transcript-asr-dlq.fifo is empty or does not exist"

aws sqs purge-queue \
  --endpoint-url "$ENDPOINT" \
  --region "$REGION" \
  --queue-url "http://localhost:4566/000000000000/OrchestratorControlQueue" \
  2>/dev/null && echo "  ✓ OrchestratorControlQueue purged" || echo "  → OrchestratorControlQueue is empty or does not exist"

echo ""
echo "========================================="
echo "Data cleared!"
echo "========================================="
