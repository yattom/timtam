import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { validateGraspConfigYaml } from './validation';

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const GRASP_CONFIGS_TABLE = process.env.GRASP_CONFIGS_TABLE || 'timtam-grasp-configs';
const MEETINGS_METADATA_TABLE = process.env.MEETINGS_METADATA_TABLE || 'timtam-meetings-metadata';
const CONTROL_SQS_URL = process.env.CONTROL_SQS_URL || '';

const ddbClient = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(ddbClient);
const sqs = new SQSClient({});

/**
 * POST /meetings/{meetingId}/grasp-config
 * Apply a Grasp configuration to a specific meeting
 * Body: { configId: string }
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

    const meetingId = event.pathParameters?.meetingId;
    if (!meetingId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'meetingId is required' }),
      };
    }

    let body: any = {};
    if (event.body) {
      try {
        body = JSON.parse(event.body);
      } catch (parseError) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ok: false, error: 'Invalid JSON in request body' }),
        };
      }
    }
    const { configId } = body;

    if (!configId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'configId is required' }),
      };
    }

    // Retrieve config from DynamoDB
    const result = await ddb.send(
      new GetCommand({
        TableName: GRASP_CONFIGS_TABLE,
        Key: { configId },
      })
    );

    if (!result.Item) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'Configuration not found' }),
      };
    }

    const yaml = result.Item.yaml;
    const configName = result.Item.name;

    // Validate YAML format
    if (typeof yaml !== 'string' || yaml.trim() === '') {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'yaml must be non-empty' }),
      };
    }

    try {
      validateGraspConfigYaml(yaml);
    } catch (validationError: any) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ok: false,
          error: validationError?.message || 'YAML validation failed',
        }),
      };
    }

    const trimmedYaml = yaml.trim();

    // Update meeting metadata with graspConfigId
    await ddb.send(
      new UpdateCommand({
        TableName: MEETINGS_METADATA_TABLE,
        Key: { meetingId },
        UpdateExpression: 'SET graspConfigId = :configId',
        ExpressionAttributeValues: {
          ':configId': configId,
        },
      })
    );

    // Send control message to orchestrator via SQS
    const controlMessage = {
      type: 'apply_grasp_config',
      meetingId,
      yaml: trimmedYaml,
      configName, // Optional: include config name for notification
    };

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: CONTROL_SQS_URL,
        MessageBody: JSON.stringify(controlMessage),
      })
    );

    console.log(JSON.stringify({
      type: 'grasp.config.applied.to.meeting',
      meetingId,
      configId,
      configName,
      yamlLength: trimmedYaml.length,
    }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        meetingId,
        configId,
        configName,
      }),
    };
  } catch (err: any) {
    console.error('[ApplyGraspConfigToMeeting] Error', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err?.message || 'Internal server error' }),
    };
  }
};
