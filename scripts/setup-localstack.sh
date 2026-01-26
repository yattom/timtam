#!/bin/bash

# LocalStack Setup Script for Timtam Local Development
# This script initializes DynamoDB tables and SQS queues in LocalStack

set -e

LOCALSTACK_ENDPOINT="http://localhost:4566"
AWS_REGION="ap-northeast-1"

echo "========================================="
echo "LocalStack Setup for Timtam"
echo "========================================="
echo "Endpoint: $LOCALSTACK_ENDPOINT"
echo "Region: $AWS_REGION"
echo ""

# Wait for LocalStack to be ready
echo "Waiting for LocalStack to be ready..."
max_attempts=30
attempt=0
until curl -s "$LOCALSTACK_ENDPOINT/_localstack/health" > /dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ $attempt -ge $max_attempts ]; then
    echo "ERROR: LocalStack did not start within expected time"
    exit 1
  fi
  echo "Attempt $attempt/$max_attempts..."
  sleep 2
done
echo "✓ LocalStack is ready"
echo ""

# Create DynamoDB Tables
echo "Creating DynamoDB tables..."

# 1. timtam-meetings-metadata
aws dynamodb create-table \
  --endpoint-url "$LOCALSTACK_ENDPOINT" \
  --region "$AWS_REGION" \
  --table-name timtam-meetings-metadata \
  --attribute-definitions \
    AttributeName=meetingId,AttributeType=S \
    AttributeName=meetingCode,AttributeType=S \
  --key-schema \
    AttributeName=meetingId,KeyType=HASH \
  --global-secondary-indexes \
    '[{"IndexName":"meetingCode-index","KeySchema":[{"AttributeName":"meetingCode","KeyType":"HASH"}],"Projection":{"ProjectionType":"ALL"}}]' \
  --billing-mode PAY_PER_REQUEST \
  > /dev/null 2>&1 || echo "  → timtam-meetings-metadata already exists"

echo "✓ timtam-meetings-metadata"

# 2. timtam-ai-messages
aws dynamodb create-table \
  --endpoint-url "$LOCALSTACK_ENDPOINT" \
  --region "$AWS_REGION" \
  --table-name timtam-ai-messages \
  --attribute-definitions \
    AttributeName=meetingId,AttributeType=S \
    AttributeName=timestamp,AttributeType=N \
  --key-schema \
    AttributeName=meetingId,KeyType=HASH \
    AttributeName=timestamp,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  > /dev/null 2>&1 || echo "  → timtam-ai-messages already exists"

echo "✓ timtam-ai-messages"

# 3. timtam-orchestrator-config
aws dynamodb create-table \
  --endpoint-url "$LOCALSTACK_ENDPOINT" \
  --region "$AWS_REGION" \
  --table-name timtam-orchestrator-config \
  --attribute-definitions \
    AttributeName=configId,AttributeType=S \
  --key-schema \
    AttributeName=configId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  > /dev/null 2>&1 || echo "  → timtam-orchestrator-config already exists"

echo "✓ timtam-orchestrator-config"

echo ""

# Create SQS FIFO Queue
echo "Creating SQS FIFO queue..."

aws sqs create-queue \
  --endpoint-url "$LOCALSTACK_ENDPOINT" \
  --region "$AWS_REGION" \
  --queue-name transcript-asr.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=true \
  > /dev/null 2>&1 || echo "  → transcript-asr.fifo already exists"

echo "✓ transcript-asr.fifo"

echo ""

# Create S3 Bucket (if needed)
echo "Creating S3 bucket..."

aws s3 mb s3://timtam-local-dev \
  --endpoint-url "$LOCALSTACK_ENDPOINT" \
  --region "$AWS_REGION" \
  > /dev/null 2>&1 || echo "  → timtam-local-dev already exists"

echo "✓ timtam-local-dev"

echo ""
echo "========================================="
echo "LocalStack setup complete!"
echo "========================================="
echo ""
echo "Available resources:"
echo "  - DynamoDB: timtam-meetings-metadata"
echo "  - DynamoDB: timtam-ai-messages"
echo "  - DynamoDB: timtam-orchestrator-config"
echo "  - SQS FIFO: transcript-asr.fifo"
echo "  - S3: timtam-local-dev"
echo ""
echo "Endpoint: $LOCALSTACK_ENDPOINT"
echo ""
