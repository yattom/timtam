#!/bin/bash
set -e

# Build facilitator UI with API URL from CloudFormation
STACK_NAME="${STACK_NAME:-TimtamInfraStack}"

echo "Fetching API endpoint from CloudFormation..."
API_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --profile admin \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
  --output text 2>/dev/null || echo "")

if [ -z "$API_ENDPOINT" ]; then
  echo "Warning: Could not fetch API endpoint from CloudFormation."
  echo "Using placeholder URL. The app will not work until you set NEXT_PUBLIC_API_URL."
  API_ENDPOINT="https://your-api-gateway.amazonaws.com"
fi

echo "API Endpoint: $API_ENDPOINT"

# Build facilitator with API URL
echo "Building facilitator UI..."
cd "$(dirname "$0")/../web/facilitator"
NEXT_PUBLIC_API_URL="$API_ENDPOINT" pnpm build

echo "Facilitator build complete!"
echo "Output directory: $(pwd)/out"
