import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { parseGraspGroupDefinition } from '../orchestrator/graspConfigParser';

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const GRASP_CONFIGS_TABLE = process.env.GRASP_CONFIGS_TABLE || 'timtam-grasp-configs';

const ddbClient = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(ddbClient);

/**
 * POST /grasp/configs
 * Save a named Grasp configuration
 * Body: { name: string, yaml: string }
 */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const { name, yaml } = body;

    // Validation
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
      parseGraspGroupDefinition(yaml);
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
    const trimmedName = name.trim();
    const createdAt = Date.now();

    // Generate configId with name and timestamp
    // Format: {name}_{timestamp} (e.g., "my-config_20260125_003500")
    const timestamp = new Date(createdAt);
    const year = timestamp.getFullYear();
    const month = String(timestamp.getMonth() + 1).padStart(2, '0');
    const day = String(timestamp.getDate()).padStart(2, '0');
    const hours = String(timestamp.getHours()).padStart(2, '0');
    const minutes = String(timestamp.getMinutes()).padStart(2, '0');
    const seconds = String(timestamp.getSeconds()).padStart(2, '0');
    const timestampStr = `${year}${month}${day}_${hours}${minutes}${seconds}`;

    // Sanitize name for use in ID (remove special characters)
    const sanitizedName = trimmedName.replace(/[^a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF-]/g, '-');
    const configId = `${sanitizedName}_${timestampStr}`;

    // Save to DynamoDB
    await ddb.send(
      new PutCommand({
        TableName: GRASP_CONFIGS_TABLE,
        Item: {
          configId,
          name: trimmedName,
          yaml: trimmedYaml,
          createdAt,
          updatedAt: createdAt,
        },
      })
    );

    console.log(JSON.stringify({
      type: 'grasp.config.saved',
      configId,
      name: trimmedName,
      yamlLength: trimmedYaml.length,
      createdAt,
      updatedAt: createdAt,
    }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        configId,
        name: trimmedName,
        yaml: trimmedYaml,
        createdAt,
        updatedAt: createdAt,
      }),
    };
  } catch (err: any) {
    console.error('[SaveGraspConfig] Error', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err?.message || 'Internal server error' }),
    };
  }
};
