import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import {
  ChimeSDKMeetingsClient,
  StopMeetingTranscriptionCommand,
} from '@aws-sdk/client-chime-sdk-meetings';

const REGION = process.env.AWS_REGION || 'ap-northeast-1';

const chime = new ChimeSDKMeetingsClient({ region: REGION });

/**
 * Stop live transcription for a meeting
 *
 * POST /meetings/{meetingId}/transcription/stop
 *
 * NOTE: Media Capture Pipeline cleanup removed since we no longer create pipelines.
 */
export const stop: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const pathId = event.pathParameters?.meetingId;
    const meetingId: string | undefined = pathId || body.meetingId;
    if (!meetingId) throw new Error('meetingId is required');

    // Stop client-side transcription
    const resp = await chime.send(
      new StopMeetingTranscriptionCommand({
        MeetingId: meetingId,
      })
    );
    console.log('[TranscriptionStop] Client-side transcription stopped', {
      meetingId,
      requestId: (resp as any)?.$metadata?.requestId
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        meetingId,
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
