import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { createHash } from 'crypto';

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const TRANSCRIPT_QUEUE_URL = process.env.TRANSCRIPT_QUEUE_URL || '';  // ADR-0011: SQS FIFO queue

const sqs = new SQSClient({ region: REGION });

/**
 * POST /meetings/{meetingId}/transcription/events
 *
 * Receives TranscriptEvent from browser and forwards to SQS FIFO queue (ADR-0011)
 * This replaces the server-side audio capture + Transcribe batch job flow
 *
 * Request body:
 * {
 *   attendeeId: string;        // ChimeSDK attendeeId (speaker identifier)
 *   externalUserId?: string;   // External user ID if available
 *   text: string;              // Transcribed text
 *   isFinal: boolean;          // Whether this is final or partial result
 *   timestamp?: number;        // Client timestamp (epoch ms)
 * }
 */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const pathMeetingId = event.pathParameters?.meetingId;

    if (!pathMeetingId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'meetingId is required in path' }),
      };
    }

    if (!event.body) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'Request body is required' }),
      };
    }

    const body = JSON.parse(event.body);
    const {
      attendeeId,
      externalUserId,
      text,
      isFinal,
      timestamp,
      resultId,
    } = body;

    // Validate required fields
    if (!attendeeId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'attendeeId is required' }),
      };
    }

    if (typeof text !== 'string' || text.length === 0) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'text is required and must be non-empty string' }),
      };
    }

    if (typeof isFinal !== 'boolean') {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'isFinal must be boolean' }),
      };
    }

    // Create AsrEvent format compatible with Orchestrator
    const asrEvent = {
      meetingId: pathMeetingId,
      speakerId: externalUserId || attendeeId, // Prefer externalUserId, fallback to attendeeId
      text,
      isFinal,
      timestamp: timestamp || Date.now(),
      sequenceNumber: undefined, // Not applicable for client-side events
    };

    // ADR-0011: Write to SQS
    try {
      // Generate a deduplication ID to prevent duplicate processing from multiple participants
      // Prefer resultId if available (for final transcripts), as it's a stable identifier from Chime.
      // As a fallback (for partials or older clients), use a hash of the text plus a time window.
      let deduplicationId: string;
      if (resultId) {
        deduplicationId = resultId;
      } else {
        // Group events within a ~2-second window to catch duplicates of short, identical phrases.
        const timeWindow = Math.round((timestamp || Date.now()) / 2000);
        const hash = createHash('sha256').update(`${text}-${timeWindow}`).digest('hex');
        deduplicationId = `${pathMeetingId}-${hash}`;
      }

      await sqs.send(
        new SendMessageCommand({
          QueueUrl: TRANSCRIPT_QUEUE_URL,
          MessageBody: JSON.stringify(asrEvent),
          MessageGroupId: pathMeetingId,  // Ensures ordering per meeting
          MessageDeduplicationId: deduplicationId, // Prevents duplicates within 5-min window
        })
      );
      console.log('[TranscriptionEvents] Written to SQS', {
        meetingId: pathMeetingId,
        speakerId: asrEvent.speakerId,
        textLength: text.length,
        isFinal,
      });
    } catch (err) {
      console.error('[TranscriptionEvents] SQS write failed', err);
      throw err;
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    };
  } catch (err: any) {
    console.error('[TranscriptionEvents] Failed to process event', err?.message || err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err?.message || String(err) }),
    };
  }
};
