import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { KinesisClient, PutRecordCommand } from '@aws-sdk/client-kinesis';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const KINESIS_STREAM_NAME = process.env.KINESIS_STREAM_NAME || 'transcript-asr';
const TRANSCRIPT_QUEUE_URL = process.env.TRANSCRIPT_QUEUE_URL || '';  // ADR-0011: SQS FIFO queue

const kinesis = new KinesisClient({ region: REGION });
const sqs = new SQSClient({ region: REGION });

/**
 * POST /meetings/{meetingId}/transcription/events
 *
 * Receives TranscriptEvent from browser and forwards to Kinesis
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
      timestamp
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

    // ADR-0011 Phase 1: Write to both Kinesis and SQS for parallel operation
    // Write to Kinesis (legacy)
    await kinesis.send(
      new PutRecordCommand({
        StreamName: KINESIS_STREAM_NAME,
        Data: Buffer.from(JSON.stringify(asrEvent)),
        PartitionKey: pathMeetingId, // Partition by meetingId for ordering
      })
    );

    // Write to SQS FIFO (new)
    if (TRANSCRIPT_QUEUE_URL) {
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: TRANSCRIPT_QUEUE_URL,
          MessageBody: JSON.stringify(asrEvent),
          MessageGroupId: pathMeetingId,  // Ensures ordering per meeting
        })
      );
    }

    console.log('[TranscriptionEvents] Event written to Kinesis and SQS', {
      meetingId: pathMeetingId,
      speakerId: asrEvent.speakerId,
      textLength: text.length,
      isFinal,
    });

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
