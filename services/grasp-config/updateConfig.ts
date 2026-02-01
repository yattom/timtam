import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { validateGraspConfigYaml } from './validation';

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const CONFIG_TABLE = process.env.CONFIG_TABLE_NAME || 'timtam-orchestrator-config';
const CONTROL_SQS_URL = process.env.CONTROL_SQS_URL || '';

const ddbClient = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(ddbClient);
const sqs = new SQSClient({});

/**
 * PUT /grasp/config
 * Update the Grasp configuration
 * Body: { yaml: string }
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
    const yaml = body.yaml;

    // Validation
    if (typeof yaml !== 'string' || yaml.trim() === '') {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'yaml is required and must be non-empty' }),
      };
    }

    // Validate YAML format and structure
    try {
      validateGraspConfigYaml(yaml);
    } catch (validationError: any) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ok: false,
          error: validationError?.message || 'YAML validation failed',
          validationErrors: [{
            field: 'yaml',
            message: validationError?.message || 'Invalid YAML format'
          }]
        }),
      };
    }

    const trimmedYaml = yaml.trim();
    const updatedAt = Date.now();

    // Save to DynamoDB
    await ddb.send(
      new PutCommand({
        TableName: CONFIG_TABLE,
        Item: {
          configKey: 'current_grasp_config',
          yaml: trimmedYaml,
          updatedAt,
        },
      })
    );

    // Send control message to orchestrator via SQS
    const controlMessage = {
      type: 'grasp_config',
      yaml: trimmedYaml,
    };

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: CONTROL_SQS_URL,
        MessageBody: JSON.stringify(controlMessage),
      })
    );

    console.log(JSON.stringify({
      type: 'grasp.config.updated',
      yamlLength: trimmedYaml.length,
      updatedAt,
    }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        yaml: trimmedYaml,
        updatedAt,
      }),
    };
  } catch (err: any) {
    console.error('[UpdateGraspConfig] Error', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err?.message || 'Internal server error' }),
    };
  }
};
