import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { validateGraspConfigYaml } from './validation';

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const GRASP_CONFIGS_TABLE = process.env.GRASP_CONFIGS_TABLE || 'timtam-grasp-configs';

const ddbClient = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(ddbClient);

/**
 * POST /grasp/presets
 * Save a new Grasp configuration preset
 * Body: { configId: string, name: string, yaml: string, isDefault?: boolean }
 */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const { configId, name, yaml, isDefault } = body;

    // Validation
    if (typeof configId !== 'string' || configId.trim() === '') {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'configId is required and must be non-empty' }),
      };
    }

    if (typeof name !== 'string' || name.trim() === '') {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'name is required and must be non-empty' }),
      };
    }

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

    const now = Date.now();

    // Save to DynamoDB
    await ddb.send(
      new PutCommand({
        TableName: GRASP_CONFIGS_TABLE,
        Item: {
          configId: configId.trim(),
          name: name.trim(),
          yaml: yaml.trim(),
          isDefault: isDefault === true,
          createdAt: now,
          updatedAt: now,
        },
      })
    );

    console.log(JSON.stringify({
      type: 'grasp.preset.saved',
      configId: configId.trim(),
      name: name.trim(),
      updatedAt: now,
    }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        configId: configId.trim(),
        name: name.trim(),
        updatedAt: now,
      }),
    };
  } catch (err: any) {
    console.error('[SaveGraspPreset] Error', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err?.message || 'Internal server error' }),
    };
  }
};
