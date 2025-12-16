import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const CONFIG_TABLE = process.env.CONFIG_TABLE_NAME || 'timtam-orchestrator-config';
const CONTROL_SQS_URL = process.env.CONTROL_SQS_URL || '';

const ddbClient = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(ddbClient);
const sqs = new SQSClient({});

/**
 * PUT /orchestrator/prompt
 * Update the orchestrator prompt configuration
 * Body: { prompt: string }
 */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    if (!CONTROL_SQS_URL) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'CONTROL_SQS_URL is not configured' }),
      };
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const prompt = body.prompt;

    // Validation
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'prompt is required and must be non-empty' }),
      };
    }

    if (prompt.length > 2000) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'prompt must be 2000 characters or less' }),
      };
    }

    const trimmedPrompt = prompt.trim();
    const updatedAt = Date.now();

    // Save to DynamoDB
    await ddb.send(
      new PutCommand({
        TableName: CONFIG_TABLE,
        Item: {
          configKey: 'current_prompt',
          prompt: trimmedPrompt,
          updatedAt,
        },
      })
    );

    // Send control message to orchestrator via SQS
    const controlMessage = {
      type: 'prompt',
      prompt: trimmedPrompt,
    };

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: CONTROL_SQS_URL,
        MessageBody: JSON.stringify(controlMessage),
      })
    );

    console.log(JSON.stringify({
      type: 'orchestrator.config.prompt.updated',
      promptLength: trimmedPrompt.length,
      updatedAt,
    }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        prompt: trimmedPrompt,
        updatedAt,
      }),
    };
  } catch (err: any) {
    console.error('[UpdatePrompt] Error', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err?.message || 'Internal server error' }),
    };
  }
};
