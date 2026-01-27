#!/bin/bash
# Sync LocalStack schema with CDK definitions

set -e

echo "=== Syncing LocalStack Schema with CDK ==="
echo ""

# 1. CDK Synth
echo "1. Synthesizing CDK stack..."
cd infra/cdk
pnpm install --silent 2>&1 > /dev/null || true
pnpm run synth 2>&1 | grep -E "(Stack|Template)" || true
cd ../..
echo "✓ CDK synth complete"
echo ""

# 2. Generate script
echo "2. Generating LocalStack setup script from CDK..."
npx ts-node scripts/generate-localstack-setup.ts
echo ""

# 3. Deploy to LocalStack
echo "3. Running generated setup script..."
chmod +x scripts/setup-localstack.sh
./scripts/setup-localstack.sh
echo ""

echo "✓ Schema sync complete!"
echo ""
echo "DynamoDB endpoint: http://localhost:4566"
echo "SQS endpoint: http://localhost:4566"
echo ""
echo "To verify:"
echo "  aws dynamodb list-tables --endpoint-url http://localhost:4566 --region ap-northeast-1"
echo "  aws sqs list-queues --endpoint-url http://localhost:4566 --region ap-northeast-1"
