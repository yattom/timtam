import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { validateGraspConfigYaml } from './validation';

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const GRASP_CONFIGS_TABLE = process.env.GRASP_CONFIGS_TABLE || 'timtam-grasp-configs';

const ddbClient = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(ddbClient);

/**
 * Plant names for generating random fallback names
 */
const PLANT_NAMES = [
  'oak', 'pine', 'maple', 'birch', 'willow', 'cedar', 'ash', 'elm',
  'rose', 'lily', 'tulip', 'daisy', 'iris', 'orchid', 'lotus', 'peony',
  'corn', 'wheat', 'rice', 'barley', 'oat', 'rye', 'millet', 'soy',
  'apple', 'cherry', 'peach', 'plum', 'pear', 'orange', 'lemon', 'lime',
  'bamboo', 'fern', 'moss', 'ivy', 'clover', 'sage', 'mint', 'basil',
  'lavender', 'jasmine', 'violet', 'poppy', 'sunflower', 'cosmos', 'zinnia', 'azalea'
];

/**
 * Number of plant names to combine for generated config names
 */
const PLANT_NAME_COUNT = 3;

/**
 * Generate a random plant-based name (e.g., "oak-corn-rose")
 */
function generateRandomPlantName(): string {
  const selected: string[] = [];
  const available = [...PLANT_NAMES];
  
  for (let i = 0; i < PLANT_NAME_COUNT; i++) {
    const index = Math.floor(Math.random() * available.length);
    selected.push(available[index]);
    available.splice(index, 1);
  }
  
  return selected.join('-');
}

/**
 * POST /grasp/configs
 * Save a named Grasp configuration
 * Body: { name: string, yaml: string, createdAt: number }
 */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    let body: any;
    try {
      body = event.body ? JSON.parse(event.body) : {};
    } catch (parseError: any) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'Invalid JSON in request body' }),
      };
    }
    const { name, yaml, createdAt } = body;

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

    if (typeof createdAt !== 'number' || createdAt <= 0 || !Number.isFinite(createdAt)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'createdAt is required and must be a valid timestamp' }),
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
    const trimmedName = name.trim();

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
    
    // Check if sanitized name is recognizable (has at least one alphanumeric or Japanese character)
    const hasValidChar = /[a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(sanitizedName);
    
    // If not recognizable, generate a random plant-based name
    const finalName = hasValidChar ? sanitizedName : generateRandomPlantName();
    const configId = `${finalName}_${timestampStr}`;

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
