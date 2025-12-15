import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import {
  ChimeSDKMeetingsClient,
  StartMeetingTranscriptionCommand,
} from '@aws-sdk/client-chime-sdk-meetings';
import {
  ChimeSDKMediaPipelinesClient,
  CreateMediaCapturePipelineCommand,
} from '@aws-sdk/client-chime-sdk-media-pipelines';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const PIPELINE_TABLE_NAME = process.env.PIPELINE_TABLE_NAME!;
const TRANSCRIPT_STREAM_ARN = process.env.TRANSCRIPT_STREAM_ARN!;
const CAPTURE_BUCKET_ARN = process.env.CAPTURE_BUCKET_ARN!;
const AWS_ACCOUNT_ID = process.env.AWS_ACCOUNT_ID!;

const chime = new ChimeSDKMeetingsClient({ region: REGION });
const mediaPipelines = new ChimeSDKMediaPipelinesClient({ region: REGION });
const ddbClient = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(ddbClient);

// ライブ文字起こし開始（ja-JP）
// path: /meetings/{meetingId}/transcription/start
// body (optional): { meetingId?: string, languageCode?: string }
export const start: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const pathId = event.pathParameters?.meetingId;
    const meetingId: string | undefined = pathId || body.meetingId;
    if (!meetingId) throw new Error('meetingId is required');

    const languageCode = body.languageCode || 'ja-JP';

    // Step 1: Start client-side transcription for browser display (ADR 0008: Option A)
    const clientResp = await chime.send(
      new StartMeetingTranscriptionCommand({
        MeetingId: meetingId,
        TranscriptionConfiguration: {
          EngineTranscribeSettings: {
            LanguageCode: languageCode,
            Region: REGION,
            EnablePartialResultsStabilization: true,
            PartialResultsStability: 'medium',
          },
        },
      })
    );
    console.log('[TranscriptionStart] Client-side transcription started', {
      meetingId,
      requestId: (clientResp as any)?.$metadata?.requestId
    });

    // Step 2: Create Media Capture Pipeline for audio capture
    // NOTE: This captures audio to S3. For full integration with Transcribe → Kinesis,
    // we need to implement a consumer that reads from S3/KVS, transcribes, and writes to Kinesis.
    // For Phase 1 PoC, we'll use client-side transcription events forwarded from browser.
    const pipelineResp = await mediaPipelines.send(
      new CreateMediaCapturePipelineCommand({
        SourceType: 'ChimeSdkMeeting',
        SourceArn: `arn:aws:chime:${REGION}:${AWS_ACCOUNT_ID}:meeting/${meetingId}`,
        SinkType: 'S3Bucket',
        SinkArn: CAPTURE_BUCKET_ARN,
        ChimeSdkMeetingConfiguration: {
          ArtifactsConfiguration: {
            Audio: {
              MuxType: 'AudioOnly',
            },
            Content: {
              State: 'Disabled',
            },
            Video: {
              State: 'Disabled',
            },
          },
        },
      })
    );

    const pipelineArn = pipelineResp.MediaCapturePipeline?.MediaPipelineArn;
    console.log('[TranscriptionStart] Media capture pipeline created (audio to S3)', {
      meetingId,
      pipelineArn: pipelineArn || 'none',
      requestId: (pipelineResp as any)?.$metadata?.requestId
    });

    // Step 3: Store pipeline info in DynamoDB for cleanup in transcriptionStop
    if (pipelineArn) {
      await ddb.send(
        new PutCommand({
          TableName: PIPELINE_TABLE_NAME,
          Item: {
            meetingId,
            pipelineArn,
            createdAt: new Date().toISOString(),
          },
        })
      );
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        meetingId,
        languageCode,
        pipelineArn,
      }),
    };
  } catch (err: any) {
    console.error('[TranscriptionStart] failed', err?.message || err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err?.message || String(err) }),
    };
  }
};
