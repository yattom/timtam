import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import {
  ChimeSDKMeetingsClient,
  StartMeetingTranscriptionCommand,
} from '@aws-sdk/client-chime-sdk-meetings';

const REGION = process.env.AWS_REGION || 'ap-northeast-1';

const chime = new ChimeSDKMeetingsClient({ region: REGION });

/**
 * Start live transcription for a meeting
 *
 * POST /meetings/{meetingId}/transcription/start
 *
 * This starts client-side transcription which sends TranscriptEvent to browser.
 * Browser then forwards events to /meetings/{meetingId}/transcription/events API.
 *
 * NOTE: Media Capture Pipeline removed in favor of browser-side TranscriptEvent forwarding.
 */
export const start: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const pathId = event.pathParameters?.meetingId;
    const meetingId: string | undefined = pathId || body.meetingId;
    if (!meetingId) throw new Error('meetingId is required');

    const languageCode = body.languageCode || 'ja-JP';

    // Start client-side transcription
    // TranscriptEvent will be received by browser and forwarded to server
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

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        meetingId,
        languageCode,
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
