#!/bin/bash

# Seed test data to LocalStack DynamoDB for testing

set -e

LOCALSTACK_ENDPOINT="http://localhost:4566"
AWS_REGION="ap-northeast-1"
MEETINGS_TABLE="timtam-meetings-metadata"

echo "==========================================="
echo "Seeding test data to LocalStack DynamoDB"
echo "==========================================="
echo "Endpoint: $LOCALSTACK_ENDPOINT"
echo "Table: $MEETINGS_TABLE"
echo ""

# Create a test meeting with Recall bot
NOW=$(date +%s)000  # Current timestamp in milliseconds
MEETING_ID="bot_test_$(date +%s)"
MEETING_CODE="ABC123"

echo "Creating test meeting..."
echo "  Meeting ID: $MEETING_ID"
echo "  Meeting Code: $MEETING_CODE"

aws dynamodb put-item \
  --endpoint-url "$LOCALSTACK_ENDPOINT" \
  --region "$AWS_REGION" \
  --table-name "$MEETINGS_TABLE" \
  --item "{
    \"meetingId\": {\"S\": \"$MEETING_ID\"},
    \"platform\": {\"S\": \"recall\"},
    \"status\": {\"S\": \"active\"},
    \"createdAt\": {\"N\": \"$NOW\"},
    \"meetingCode\": {\"S\": \"$MEETING_CODE\"},
    \"recallBot\": {
      \"M\": {
        \"botId\": {\"S\": \"$MEETING_ID\"},
        \"meetingUrl\": {\"S\": \"https://zoom.us/j/123456789\"},
        \"platform\": {\"S\": \"zoom\"},
        \"botName\": {\"S\": \"Test Bot\"},
        \"status\": {\"S\": \"in_meeting\"},
        \"statusMessage\": {\"S\": \"Bot is active\"}
      }
    }
  }" > /dev/null

echo "✓ Test meeting created"

# Create another ended meeting
ENDED_MEETING_ID="bot_ended_$(date +%s)"
ENDED_CODE="XYZ789"
ENDED_AT=$((NOW + 3600000))  # 1 hour later

echo ""
echo "Creating ended meeting..."
echo "  Meeting ID: $ENDED_MEETING_ID"
echo "  Meeting Code: $ENDED_CODE"

aws dynamodb put-item \
  --endpoint-url "$LOCALSTACK_ENDPOINT" \
  --region "$AWS_REGION" \
  --table-name "$MEETINGS_TABLE" \
  --item "{
    \"meetingId\": {\"S\": \"$ENDED_MEETING_ID\"},
    \"platform\": {\"S\": \"recall\"},
    \"status\": {\"S\": \"ended\"},
    \"createdAt\": {\"N\": \"$((NOW - 7200000))\"},
    \"endedAt\": {\"N\": \"$((NOW - 3600000))\"},
    \"meetingCode\": {\"S\": \"$ENDED_CODE\"},
    \"recallBot\": {
      \"M\": {
        \"botId\": {\"S\": \"$ENDED_MEETING_ID\"},
        \"meetingUrl\": {\"S\": \"https://meet.google.com/abc-defg-hij\"},
        \"platform\": {\"S\": \"google_meet\"},
        \"botName\": {\"S\": \"Ended Bot\"},
        \"status\": {\"S\": \"done\"},
        \"statusMessage\": {\"S\": \"Bot left the meeting\"}
      }
    }
  }" > /dev/null

echo "✓ Ended meeting created"

echo ""
echo "==========================================="
echo "Test data seeded successfully!"
echo "==========================================="
echo ""
echo "Meetings created:"
echo "  1. Active meeting: $MEETING_ID (code: $MEETING_CODE)"
echo "  2. Ended meeting: $ENDED_MEETING_ID (code: $ENDED_CODE)"
echo ""
echo "Verify with:"
echo "  curl http://localhost:3000/recall/meetings | jq ."
echo ""
