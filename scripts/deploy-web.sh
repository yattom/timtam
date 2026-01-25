#!/bin/bash
set -e

# Deploy web assets to S3 and invalidate CloudFront cache
# This script replaces the slow BucketDeployment custom resource

STACK_NAME="${STACK_NAME:-TimtamInfraStack}"
WEB_DIST_DIR="$(dirname "$0")/../web/timtam-web/dist"

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

if [ ! -d "$WEB_DIST_DIR" ]; then
  echo "Error: Web dist directory not found at $WEB_DIST_DIR"
  echo "Run 'pnpm run web:build' first"
  exit 1
fi

# Generate config.js
echo "Generating config.js..."
cat > "$WEB_DIST_DIR/config.js" <<EOF
window.API_BASE_URL='$API_ENDPOINT';
EOF

# Upload to S3 (into timtam-web/ subdirectory)
echo "Uploading to S3..."
aws s3 sync "$WEB_DIST_DIR/" "s3://$BUCKET_NAME/timtam-web/" \
  --delete \
  --cache-control "public, max-age=31536000, immutable" \
  --exclude "*.html" \
  --exclude "config.js"

# Upload HTML and config.js with no-cache
aws s3 sync "$WEB_DIST_DIR/" "s3://$BUCKET_NAME/timtam-web/" \
  --cache-control "public, max-age=0, must-revalidate" \
  --exclude "*" \
  --include "*.html" \
  --include "config.js"

# Invalidate CloudFront cache
echo "Invalidating CloudFront cache..."
aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" \
  --paths "/*" \
  --query 'Invalidation.Id' \
  --output text

echo "Web deployment complete!"
