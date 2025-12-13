import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import {
  ChimeSDKMeetingsClient,
  StopMeetingTranscriptionCommand,
} from '@aws-sdk/client-chime-sdk-meetings';

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const chime = new ChimeSDKMeetingsClient({ region: REGION });

// ライブ文字起こし停止
// path: /meetings/{meetingId}/transcription/stop
// body (optional): { meetingId?: string }
export const stop: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const pathId = event.pathParameters?.meetingId;
    const meetingId: string | undefined = pathId || body.meetingId;
    if (!meetingId) throw new Error('meetingId is required');

    console.log('[TranscriptionStop] stopping', { region: REGION, meetingId });
    const resp = await chime.send(
      new StopMeetingTranscriptionCommand({
        MeetingId: meetingId,
      })
    );
    console.log('[TranscriptionStop] stopped OK', { meetingId, requestId: (resp as any)?.$metadata?.requestId });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, meetingId }),
    };
  } catch (err: any) {
    console.error('[TranscriptionStop] failed', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err?.message || String(err) }),
    };
  }
};
