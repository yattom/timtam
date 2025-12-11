import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import {
  ChimeSDKMeetingsClient,
  StartMeetingTranscriptionCommand,
} from '@aws-sdk/client-chime-sdk-meetings';

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const chime = new ChimeSDKMeetingsClient({ region: REGION });

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

    await chime.send(
      new StartMeetingTranscriptionCommand({
        MeetingId: meetingId,
        TranscriptionConfiguration: {
          EngineTranscribeSettings: {
            LanguageCode: languageCode,
            PartialResultsStability: 'medium',
          },
        },
      })
    );

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    };
  } catch (err: any) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err?.message || String(err) }),
    };
  }
};
