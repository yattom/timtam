# Implementation Progress: Third-Party Meeting Service Integration

## Overview

This document tracks the implementation progress for Issue #45: integrating with third-party meeting services (Zoom, Google Meet, Microsoft Teams) via Recall.ai.

## Completed Work

### Phase 1: Abstraction Layer (✅ Core Complete)

**Completed**:
1. ✅ Interface definitions for meeting service adapters
2. ✅ `ChimeNotifier` implementation (refactored from existing code)
3. ✅ `RecallNotifier` implementation (with Recall.ai API client)
4. ✅ Refactored `worker.ts` to use `ChimeNotifier`
5. ✅ Created ADR 0014 documenting the architecture decision

**Created Files**:
- `services/orchestrator/src/adapters/MeetingServiceAdapter.ts` - Full adapter interface
- `services/orchestrator/src/adapters/ChimeNotifier.ts` - Chime SDK notifier
- `services/orchestrator/src/adapters/RecallNotifier.ts` - Recall.ai notifier
- `services/orchestrator/src/adapters/ChimeSDKAdapter.ts` - Full Chime adapter (stub)
- `services/orchestrator/src/adapters/RecallAIAdapter.ts` - Full Recall adapter (stub)
- `services/orchestrator/src/adapters/AdapterFactory.ts` - Factory pattern
- `services/orchestrator/src/adapters/MessageNotifier.ts` - Re-export
- `services/orchestrator/src/adapters/index.ts` - Export all adapters
- `services/orchestrator/src/recall/RecallAPIClient.ts` - Recall.ai API client
- `docs/adr/0014-meeting-service-abstraction-layer.md` - Architecture decision record

**Modified Files**:
- `services/orchestrator/worker.ts` - Uses `ChimeNotifier` instead of inline implementation

**Status**: Core implementation complete. The abstraction layer is in place and the existing Chime SDK functionality has been refactored to use it.

### Phase 2: Recall.ai Integration (🟡 Partially Complete)

**Completed**:
1. ✅ `RecallAPIClient` - Full implementation of Recall.ai REST API
   - `createBot()` - Join a meeting
   - `getBot()` - Check bot status
   - `deleteBot()` - Leave a meeting
   - `sendChatMessage()` - Send chat messages
   - `listBots()` - List all bots
2. ✅ `RecallNotifier` - Complete implementation with API client integration
3. ✅ Type definitions for Recall.ai events (transcript, participant)

**Remaining Work**:
1. ⬜ **Webhook Handler Lambda Functions**
   - Create Lambda function to receive Recall.ai webhooks
   - Handle `bot.transcript` events (real-time transcription)
   - Handle `participant.join`/`participant.leave` events
   - Verify webhook signatures for security
   - Transform Recall events to internal `AsrEvent` format
   - Send to SQS FIFO (or new processing mechanism)

2. ⬜ **Meeting Management APIs**
   - `POST /recall/meetings/create` - Create meeting and join with bot
   - `GET /recall/meetings/{meetingId}/status` - Check bot status
   - `DELETE /recall/meetings/{meetingId}` - Leave meeting
   - Store meeting metadata (meetingId → botId mapping) in DynamoDB

3. ⬜ **DynamoDB Schema Extension**
   - Add `platform` field to `timtam-meetings-metadata`
   - Add `recallBotId` field for Recall meetings
   - Create new table `timtam-recall-bots` for bot lifecycle tracking

4. ⬜ **Infrastructure (CDK)**
   - Webhook endpoint: `POST /recall/webhook/transcript`
   - Webhook endpoint: `POST /recall/webhook/participant`
   - API Gateway routes for meeting management
   - Secrets Manager for Recall.ai API key
   - Environment variables: `RECALL_API_KEY`, `RECALL_WEBHOOK_URL`

5. ⬜ **Integration with Orchestrator**
   - Update `OrchestratorManager` to support multiple platforms
   - Handle Recall transcript events alongside Chime events
   - Use `RecallNotifier` when platform=recall

6. ⬜ **Testing**
   - Unit tests for `RecallAPIClient`
   - Integration tests with actual Zoom/Meet meetings
   - Webhook signature verification tests

**Estimated Remaining Effort**: 3-4 weeks

### Phase 3: WebUI for Recall.ai (⬜ Not Started)

**Required Work**:
1. ⬜ **UI Design**
   - Wireframes for meeting join flow
   - Real-time transcript display
   - AI response display
   - Participant list

2. ⬜ **Frontend Implementation**
   - Create new Next.js/React app: `web/timtam-recall-web/`
   - Meeting URL input form
   - Platform selection (Zoom, Google Meet, Teams, Webex)
   - Bot name configuration
   - Real-time transcript streaming (WebSocket or Server-Sent Events)
   - AI intervention message display
   - Bot leave button

3. ⬜ **Backend APIs**
   - `POST /recall/meetings/create` - Create and join meeting
   - `GET /recall/meetings/{meetingId}/transcripts` - Fetch transcripts
   - `GET /recall/meetings/{meetingId}/messages` - Fetch AI messages
   - `DELETE /recall/meetings/{meetingId}` - Leave meeting
   - WebSocket/SSE endpoint for real-time updates

4. ⬜ **Deployment**
   - S3 bucket for static assets
   - CloudFront distribution
   - CDK stack for infrastructure
   - CI/CD pipeline (GitHub Actions)

5. ⬜ **Documentation**
   - User guide for joining meetings
   - Developer guide for extending the UI

**Estimated Effort**: 4-5 weeks

## Next Steps

### Immediate (Recommended)

1. **Test Phase 1 Changes**
   - Deploy to PoC environment
   - Verify existing Chime SDK functionality still works
   - Test `ChimeNotifier` with real meetings

2. **Complete Phase 2 Core**
   - Implement webhook Lambda functions
   - Create meeting management APIs
   - Test with Recall.ai sandbox

3. **Begin Phase 3**
   - Design UI wireframes
   - Set up Next.js project structure
   - Implement basic meeting join flow

### Long-term

1. **Production Hardening**
   - Add comprehensive error handling
   - Implement retry logic for API calls
   - Add monitoring and alerting
   - Security audit (webhook signatures, API key rotation)

2. **Feature Enhancements**
   - Support for multiple concurrent Recall meetings
   - Recording and playback
   - Advanced participant management
   - Custom bot behaviors per platform

## Architecture Summary

### Current State (Phase 1)

```
Browser (Chime SDK)
  ↓ TranscriptEvent
API Gateway → Lambda
  ↓ SendMessage
SQS FIFO Queue
  ↓ Long polling
ECS Orchestrator (worker.ts)
  ↓ processAsrEvent
Meeting Orchestrator
  ↓ Grasp processing
ChimeNotifier.postChat() ← New abstraction
  ↓ PutCommand
DynamoDB (ai-messages)
  ↓ polling
Browser display
```

### Target State (Phase 2 + 3)

```
[Chime Path - Existing]
Browser (Chime SDK) → API → SQS → Orchestrator → ChimeNotifier → DynamoDB

[Recall Path - New]
Recall.ai Bot → Webhook → Lambda → SQS → Orchestrator → RecallNotifier → Recall Chat API

[New WebUI]
Browser → Recall WebUI → API → Recall.ai (create bot) → Meeting
                       ↗ API → Fetch transcripts/messages
```

## Key Design Decisions

1. **Gradual Migration**: Phase 1 maintains backward compatibility
2. **Adapter Pattern**: Clean separation between platforms
3. **Shared Orchestrator**: Both platforms use same Grasp logic
4. **Platform-Specific Notifiers**: `ChimeNotifier` vs `RecallNotifier`
5. **Webhook-Based**: Recall.ai uses webhooks instead of SQS polling

## References

- Issue #45: https://github.com/yattom/timtam/issues/45
- ADR 0009: Third-Party Meeting Service Integration
- ADR 0014: Meeting Service Abstraction Layer
- Recall.ai API Docs: https://docs.recall.ai/
