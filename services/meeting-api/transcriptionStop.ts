import { APIGatewayProxyHandlerV2 } from 'aws-lambda';

// TODO: 実装：Chime StopMeetingTranscription を呼び出す
export const stop: APIGatewayProxyHandlerV2 = async () => {
  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, action: 'transcriptionStop', note: 'stub' }),
    headers: { 'Content-Type': 'application/json' },
  };
};
