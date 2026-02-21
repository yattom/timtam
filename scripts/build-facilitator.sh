#!/bin/bash
set -e

# Build facilitator UI with API URL from CloudFormation
STACK_NAME="${STACK_NAME:-TimtamInfraStack}"

echo "Fetching stack outputs from CloudFormation..."
API_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --profile admin \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
  --output text 2>/dev/null || echo "")

USER_POOL_ID=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --profile admin \
  --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' \
  --output text 2>/dev/null || echo "")

USER_POOL_CLIENT_ID=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --profile admin \
  --query 'Stacks[0].Outputs[?OutputKey==`UserPoolClientId`].OutputValue' \
  --output text 2>/dev/null || echo "")

if [ -z "$API_ENDPOINT" ]; then
  echo "Warning: Could not fetch API endpoint from CloudFormation."
  echo "Using placeholder URL. The app will not work until you set NEXT_PUBLIC_API_URL."
  API_ENDPOINT="https://your-api-gateway.amazonaws.com"
fi

echo "API Endpoint: $API_ENDPOINT"
echo "User Pool ID: $USER_POOL_ID"
echo "User Pool Client ID: $USER_POOL_CLIENT_ID"

# Build facilitator with API URL and Cognito config
echo "Building facilitator UI..."
cd "$(dirname "$0")/../web/facilitator"
NEXT_PUBLIC_API_URL="$API_ENDPOINT" \
  NEXT_PUBLIC_COGNITO_USER_POOL_ID="$USER_POOL_ID" \
  NEXT_PUBLIC_COGNITO_CLIENT_ID="$USER_POOL_CLIENT_ID" \
  pnpm build

echo "Facilitator build complete!"
echo "Output directory: $(pwd)/out"
