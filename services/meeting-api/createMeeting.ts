import { APIGatewayProxyHandlerV2 } from 'aws-lambda';

// TODO: 実装：Chime CreateMeeting + CreateAttendee を呼び出す
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, action: 'createMeeting', note: 'stub' }),
    headers: { 'Content-Type': 'application/json' },
  };
};
