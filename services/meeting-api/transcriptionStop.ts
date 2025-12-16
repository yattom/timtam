import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import {
  ChimeSDKMeetingsClient,
  StopMeetingTranscriptionCommand,
} from '@aws-sdk/client-chime-sdk-meetings';
import {
  ChimeSDKMediaPipelinesClient,
  DeleteMediaCapturePipelineCommand,
} from '@aws-sdk/client-chime-sdk-media-pipelines';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const PIPELINE_TABLE_NAME = process.env.PIPELINE_TABLE_NAME!;

const chime = new ChimeSDKMeetingsClient({ region: REGION });
const mediaPipelines = new ChimeSDKMediaPipelinesClient({ region: REGION });
const ddbClient = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(ddbClient);

// ライブ文字起こし停止
// path: /meetings/{meetingId}/transcription/stop
// body (optional): { meetingId?: string }
export const stop: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const pathId = event.pathParameters?.meetingId;
    const meetingId: string | undefined = pathId || body.meetingId;
    if (!meetingId) throw new Error('meetingId is required');

    // Step 1: Stop client-side transcription
    const resp = await chime.send(
      new StopMeetingTranscriptionCommand({
        MeetingId: meetingId,
      })
    );
    console.log('[TranscriptionStop] Client-side transcription stopped', {
      meetingId,
      requestId: (resp as any)?.$metadata?.requestId
    });

    // Step 2: Get pipeline ARN from DynamoDB
    const getResp = await ddb.send(
      new GetCommand({
        TableName: PIPELINE_TABLE_NAME,
        Key: { meetingId },
      })
    );

    const pipelineArn = getResp.Item?.pipelineArn;
    if (pipelineArn) {
      // Step 3: Delete Media Capture Pipeline
      try {
        const deleteResp = await mediaPipelines.send(
          new DeleteMediaCapturePipelineCommand({
            MediaPipelineId: pipelineArn,
          })
        );
        console.log('[TranscriptionStop] Media pipeline deleted', {
          meetingId,
          pipelineArn,
          requestId: (deleteResp as any)?.$metadata?.requestId
        });
      } catch (pipelineErr: any) {
        console.error('[TranscriptionStop] Failed to delete pipeline', {
          meetingId,
          pipelineArn,
          error: pipelineErr?.message || pipelineErr
        });
      }

      // Step 4: Delete DynamoDB record
      await ddb.send(
        new DeleteCommand({
          TableName: PIPELINE_TABLE_NAME,
          Key: { meetingId },
        })
      );
    } else {
      console.warn('[TranscriptionStop] No pipeline ARN found in DynamoDB', { meetingId });
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        meetingId,
        pipelineDeleted: !!pipelineArn,
      }),
    };
  } catch (err: any) {
    console.error('[TranscriptionStop] failed', err?.message || err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err?.message || String(err) }),
    };
  }
};
