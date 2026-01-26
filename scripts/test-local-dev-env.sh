#!/bin/bash

# Timtam Local Development Environment Test Script
# This script validates that the local development environment is working correctly

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Configuration
LOCALSTACK_ENDPOINT="http://localhost:4566"
RECALL_STUB_ENDPOINT="http://localhost:8080"
AWS_REGION="ap-northeast-1"

# Expected resources
EXPECTED_TABLES=("timtam-ai-messages" "timtam-meetings-metadata" "timtam-orchestrator-config")
EXPECTED_QUEUE_NAME="transcript-asr.fifo"
EXPECTED_BUCKET="timtam-local-dev"

echo "========================================="
echo "Timtam Local Dev Environment Test"
echo "========================================="
echo ""

# Helper functions
test_start() {
    TESTS_RUN=$((TESTS_RUN + 1))
    echo -n "[$TESTS_RUN] $1... "
}

test_pass() {
    TESTS_PASSED=$((TESTS_PASSED + 1))
    echo -e "${GREEN}✓ PASS${NC}"
    if [ -n "$1" ]; then
        echo "    $1"
    fi
}

test_fail() {
    TESTS_FAILED=$((TESTS_FAILED + 1))
    echo -e "${RED}✗ FAIL${NC}"
    echo "    $1"
}

# Test 1: Check if Docker is running
test_start "Docker daemon is running"
if docker info > /dev/null 2>&1; then
    test_pass
else
    test_fail "Docker is not running. Please start Docker Desktop."
    exit 1
fi

# Test 2: Check if docker-compose.yml exists
test_start "docker-compose.yml exists"
if [ -f "docker-compose.yml" ]; then
    test_pass
else
    test_fail "docker-compose.yml not found in current directory"
    exit 1
fi

# Test 3: Check LocalStack container status
test_start "LocalStack container is running"
if docker-compose ps localstack | grep -q "Up"; then
    LOCALSTACK_STATUS=$(docker-compose ps localstack | grep localstack | awk '{print $NF}')
    if echo "$LOCALSTACK_STATUS" | grep -q "healthy"; then
        test_pass "Status: healthy"
    else
        test_pass "Status: $LOCALSTACK_STATUS (may take time to become healthy)"
    fi
else
    test_fail "LocalStack container is not running. Run 'docker-compose up -d' first."
    exit 1
fi

# Test 4: Check Recall stub container status
test_start "Recall stub server container is running"
if docker-compose ps recall-stub | grep -q "Up"; then
    test_pass
else
    test_fail "Recall stub container is not running. Run 'docker-compose up -d' first."
    exit 1
fi

# Test 5: LocalStack health check
test_start "LocalStack health endpoint responds"
HEALTH_RESPONSE=$(curl -s "$LOCALSTACK_ENDPOINT/_localstack/health" || echo "ERROR")
if echo "$HEALTH_RESPONSE" | grep -q "services"; then
    test_pass
else
    test_fail "LocalStack health check failed: $HEALTH_RESPONSE"
fi

# Test 6: Recall stub health check
test_start "Recall stub health endpoint responds"
HEALTH_RESPONSE=$(curl -s -f "$RECALL_STUB_ENDPOINT/health" || echo "ERROR")
if echo "$HEALTH_RESPONSE" | grep -q "ok"; then
    BOTS_COUNT=$(echo "$HEALTH_RESPONSE" | jq -r '.bots' 2>/dev/null || echo "0")
    test_pass "Mode: STUB, Bots: $BOTS_COUNT"
else
    test_fail "Recall stub health check failed"
fi

# Test 7: DynamoDB tables exist
test_start "DynamoDB tables are created"
TABLES_JSON=$(aws dynamodb list-tables --endpoint-url "$LOCALSTACK_ENDPOINT" --region "$AWS_REGION" 2>/dev/null || echo '{"TableNames":[]}')
TABLES_COUNT=$(echo "$TABLES_JSON" | jq -r '.TableNames | length')

if [ "$TABLES_COUNT" -eq "${#EXPECTED_TABLES[@]}" ]; then
    MISSING_TABLES=()
    for table in "${EXPECTED_TABLES[@]}"; do
        if ! echo "$TABLES_JSON" | jq -r '.TableNames[]' | grep -q "^$table$"; then
            MISSING_TABLES+=("$table")
        fi
    done

    if [ ${#MISSING_TABLES[@]} -eq 0 ]; then
        test_pass "All 3 tables found: ${EXPECTED_TABLES[*]}"
    else
        test_fail "Missing tables: ${MISSING_TABLES[*]}"
    fi
else
    test_fail "Expected ${#EXPECTED_TABLES[@]} tables, found $TABLES_COUNT"
    echo "    Found: $(echo "$TABLES_JSON" | jq -r '.TableNames | join(", ")')"
fi

# Test 8: SQS FIFO queue exists
test_start "SQS FIFO queue is created"
QUEUES_JSON=$(aws sqs list-queues --endpoint-url "$LOCALSTACK_ENDPOINT" --region "$AWS_REGION" 2>/dev/null || echo '{"QueueUrls":[]}')
QUEUE_EXISTS=$(echo "$QUEUES_JSON" | jq -r '.QueueUrls[]' | grep -c "$EXPECTED_QUEUE_NAME" || echo "0")

if [ "$QUEUE_EXISTS" -eq "1" ]; then
    QUEUE_URL=$(echo "$QUEUES_JSON" | jq -r '.QueueUrls[]' | grep "$EXPECTED_QUEUE_NAME")
    test_pass "Queue: $EXPECTED_QUEUE_NAME"
else
    test_fail "Queue $EXPECTED_QUEUE_NAME not found"
fi

# Test 9: S3 bucket exists
test_start "S3 bucket is created"
BUCKETS=$(aws s3 ls --endpoint-url "$LOCALSTACK_ENDPOINT" --region "$AWS_REGION" 2>/dev/null || echo "")
if echo "$BUCKETS" | grep -q "$EXPECTED_BUCKET"; then
    test_pass "Bucket: $EXPECTED_BUCKET"
else
    test_fail "Bucket $EXPECTED_BUCKET not found"
fi

# Test 10: Recall stub API - Create bot (with localhost URL)
test_start "Recall stub API - Create bot"
BOT_RESPONSE=$(curl -s -X POST "$RECALL_STUB_ENDPOINT/api/v1/bot/" \
    -H "Content-Type: application/json" \
    -d '{"meeting_url":"localhost","bot_name":"Test Bot"}' || echo "ERROR")

BOT_ID=$(echo "$BOT_RESPONSE" | jq -r '.id' 2>/dev/null || echo "")
if [[ "$BOT_ID" =~ ^bot_ ]]; then
    test_pass "Bot created: $BOT_ID"
else
    test_fail "Failed to create bot"
    echo "    Response: $BOT_RESPONSE"
    BOT_ID=""
fi

# Test 11: Recall stub API - Get bot info
if [ -n "$BOT_ID" ]; then
    test_start "Recall stub API - Get bot info"
    BOT_INFO=$(curl -s "$RECALL_STUB_ENDPOINT/api/v1/bot/$BOT_ID/" || echo "ERROR")
    BOT_STATUS=$(echo "$BOT_INFO" | jq -r '.status' 2>/dev/null || echo "")

    if [ "$BOT_STATUS" == "in_meeting" ]; then
        test_pass "Bot status: $BOT_STATUS"
    else
        test_fail "Unexpected bot status: $BOT_STATUS"
    fi
else
    echo "    ${YELLOW}⊘ SKIP${NC} - Bot creation failed in previous test"
    TESTS_RUN=$((TESTS_RUN + 1))
fi

# Test 12: Recall stub API - Send chat message
if [ -n "$BOT_ID" ]; then
    test_start "Recall stub API - Send chat message"
    CHAT_RESPONSE=$(curl -s -X POST "$RECALL_STUB_ENDPOINT/api/v1/bot/$BOT_ID/send_chat_message/" \
        -H "Content-Type: application/json" \
        -d '{"message":"Test message"}' || echo "ERROR")

    CHAT_OK=$(echo "$CHAT_RESPONSE" | jq -r '.ok' 2>/dev/null || echo "false")
    if [ "$CHAT_OK" == "true" ]; then
        test_pass "Message sent successfully"
    else
        test_fail "Failed to send chat message"
        echo "    Response: $CHAT_RESPONSE"
    fi
else
    echo "    ${YELLOW}⊘ SKIP${NC} - Bot creation failed in previous test"
    TESTS_RUN=$((TESTS_RUN + 1))
fi

# Test 13: Recall stub Web UI is accessible
test_start "Recall stub Web UI is accessible"
WEB_UI_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$RECALL_STUB_ENDPOINT/" || echo "000")
if [ "$WEB_UI_RESPONSE" == "200" ]; then
    test_pass "Web UI: $RECALL_STUB_ENDPOINT"
else
    test_fail "Web UI returned HTTP $WEB_UI_RESPONSE"
fi

# Summary
echo ""
echo "========================================="
echo "Test Summary"
echo "========================================="
echo "Total tests: $TESTS_RUN"
echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
if [ $TESTS_FAILED -gt 0 ]; then
    echo -e "${RED}Failed: $TESTS_FAILED${NC}"
else
    echo "Failed: 0"
fi
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All tests passed! Local development environment is working correctly.${NC}"
    echo ""
    echo "You can now:"
    echo "  - Access Recall stub UI: $RECALL_STUB_ENDPOINT"
    echo "  - Access LocalStack: $LOCALSTACK_ENDPOINT"
    echo "  - View logs: docker-compose logs -f"
    echo ""
    exit 0
else
    echo -e "${RED}✗ Some tests failed. Please check the errors above.${NC}"
    echo ""
    echo "Common fixes:"
    echo "  - Run: docker-compose up -d"
    echo "  - Run: ./scripts/setup-localstack.sh"
    echo "  - Check logs: docker-compose logs"
    echo ""
    exit 1
fi
