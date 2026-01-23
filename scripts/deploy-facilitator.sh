#!/bin/bash
set -e

# Deploy facilitator UI assets to S3 and invalidate CloudFront cache
# Facilitator UI is served from /facilitator/ path

STACK_NAME="${STACK_NAME:-TimtamInfraStack}"
FACILITATOR_DIST_DIR="$(dirname "$0")/../web/facilitator/out"

echo "Fetching stack outputs..."
BUCKET_NAME=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query 'Stacks[0].Outputs[?OutputKey==`WebBucketName`].OutputValue' \
  --output text)

DISTRIBUTION_ID=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query 'Stacks[0].Outputs[?OutputKey==`WebDistributionId`].OutputValue' \
  --output text)

API_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
  --output text)

if [ -z "$BUCKET_NAME" ] || [ -z "$DISTRIBUTION_ID" ] || [ -z "$API_ENDPOINT" ]; then
  echo "Error: Could not fetch stack outputs. Make sure the stack is deployed."
  exit 1
fi

echo "Bucket: $BUCKET_NAME"
echo "Distribution: $DISTRIBUTION_ID"
echo "API Endpoint: $API_ENDPOINT"

if [ ! -d "$FACILITATOR_DIST_DIR" ]; then
  echo "Error: Facilitator dist directory not found at $FACILITATOR_DIST_DIR"
  echo "Run 'pnpm run facilitator:build' first"
  exit 1
fi

# Next.js doesn't need config.js injection - use NEXT_PUBLIC_API_URL instead
# But we can create one for consistency if needed in the future

# Upload to S3 under /facilitator/ prefix
echo "Uploading facilitator UI to S3..."
aws s3 sync "$FACILITATOR_DIST_DIR/" "s3://$BUCKET_NAME/facilitator/" \
  --delete \
  --cache-control "public, max-age=31536000, immutable" \
  --exclude "*.html"

# Upload HTML with no-cache
aws s3 sync "$FACILITATOR_DIST_DIR/" "s3://$BUCKET_NAME/facilitator/" \
  --cache-control "public, max-age=0, must-revalidate" \
  --exclude "*" \
  --include "*.html"

# Invalidate CloudFront cache for facilitator paths
echo "Invalidating CloudFront cache..."
aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" \
  --paths "/facilitator/*" "/" \
  --query 'Invalidation.Id' \
  --output text

echo "Facilitator deployment complete!"
echo "URL: https://$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query 'Stacks[0].Outputs[?OutputKey==`WebUrl`].OutputValue' \
  --output text)"
