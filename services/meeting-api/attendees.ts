import { APIGatewayProxyHandlerV2 } from 'aws-lambda';

// TODO: 実装：既存MeetingにAttendeeを追加（Chime CreateAttendee）
export const add: APIGatewayProxyHandlerV2 = async () => {
  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, action: 'addAttendee', note: 'stub' }),
    headers: { 'Content-Type': 'application/json' },
  };
};
