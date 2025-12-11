import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import {
  ChimeSDKMeetingsClient,
  CreateMeetingCommand,
  CreateAttendeeCommand,
} from '@aws-sdk/client-chime-sdk-meetings';

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const chime = new ChimeSDKMeetingsClient({ region: REGION });

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const externalMeetingId: string = body.externalMeetingId || `mtg-${Date.now()}`;
    const userId: string = body.userId || `user-${Date.now()}`;

    const meetingResp = await chime.send(
      new CreateMeetingCommand({
        MediaRegion: REGION,
        ExternalMeetingId: externalMeetingId,
      })
    );

    const meetingId = meetingResp.Meeting?.MeetingId;
    if (!meetingId) throw new Error('CreateMeeting failed: MeetingId missing');

    const attendeeResp = await chime.send(
      new CreateAttendeeCommand({
        MeetingId: meetingId,
        ExternalUserId: userId,
      })
    );

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meeting: meetingResp.Meeting, attendee: attendeeResp.Attendee }),
    };
  } catch (err: any) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err?.message || String(err) }),
    };
  }
};
