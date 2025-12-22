import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const MULTI_PROMPT_CONFIG_TABLE = process.env.MULTI_PROMPT_CONFIG_TABLE || 'timtam-multi-prompt-config';

const ddbClient = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(ddbClient);

// デフォルト設定
const DEFAULT_CONFIG = {
  version: '1.0',
  prompts: [
    {
      id: 'default-observer',
      name: 'デフォルト観察者',
      promptText: '会話の内容が具体的に寄りすぎていたり、抽象的になりすぎていたら指摘してください',
      trigger: { type: 'every' },
      stateful: false,
      outputTo: 'intervention',
    },
  ],
  globalSettings: {
    windowLines: 5,
    defaultCooldownMs: 5000,
  },
};

/**
 * GET /orchestrator/multi-prompt-config
 * マルチプロンプト設定を取得
 */
export const handler: APIGatewayProxyHandlerV2 = async () => {
  try {
    const result = await ddb.send(
      new GetCommand({
        TableName: MULTI_PROMPT_CONFIG_TABLE,
        Key: { configKey: 'current_config' },
      })
    );

    const config = result.Item?.config || DEFAULT_CONFIG;
    const updatedAt = result.Item?.updatedAt || 0;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
      body: JSON.stringify({
        config,
        updatedAt,
      }),
    };
  } catch (err: any) {
    console.error('[GetMultiPromptConfig] Error', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err?.message || 'Internal server error' }),
    };
  }
};
