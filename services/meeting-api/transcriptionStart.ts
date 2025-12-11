import { APIGatewayProxyHandlerV2 } from 'aws-lambda';

// TODO: 実装：Chime StartMeetingTranscription を呼び出す
export const start: APIGatewayProxyHandlerV2 = async () => {
  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, action: 'transcriptionStart', note: 'stub' }),
    headers: { 'Content-Type': 'application/json' },
  };
};
