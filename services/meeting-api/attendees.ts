import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { ChimeSDKMeetingsClient, CreateAttendeeCommand, GetMeetingCommand } from '@aws-sdk/client-chime-sdk-meetings';

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const chime = new ChimeSDKMeetingsClient({ region: REGION });

// 既存会議に参加者を追加
// body: { meetingId: string, userId?: string }
export const add: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const meetingId: string | undefined = body.meetingId;
    if (!meetingId) throw new Error('meetingId is required');
    const userId: string = body.userId || `user-${Date.now()}`;

    const attendee = await chime.send(
      new CreateAttendeeCommand({ MeetingId: meetingId, ExternalUserId: userId })
    );

    // 既存会議に参加するクライアントのために Meeting 情報も返す
    const meeting = await chime.send(new GetMeetingCommand({ MeetingId: meetingId }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meeting: meeting.Meeting, attendee: attendee.Attendee }),
    };
  } catch (err: any) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err?.message || String(err) }),
    };
  }
};
