import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { APIGatewayProxyHandlerV2 } from 'aws-lambda';

const sqs = new SQSClient({});
const QUEUE_URL = process.env.CONTROL_SQS_URL || '';

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    if (!QUEUE_URL) {
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'CONTROL_SQS_URL is not set' }) };
    }
    const pathMeetingId = event.pathParameters?.['meetingId'];
    const body = event.body ? JSON.parse(event.body) : {};
    const meetingId: string | undefined = body.meetingId || pathMeetingId;
    if (!meetingId) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'meetingId is required' }) };
    }
    const payload = { meetingId };
    await sqs.send(new SendMessageCommand({ QueueUrl: QUEUE_URL, MessageBody: JSON.stringify(payload) }));
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
  } catch (err: any) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err?.message || String(err) }) };
  }
};
