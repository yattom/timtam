import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { OrchestratorConfig } from '../orchestrator/multi-prompt-types';

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const MULTI_PROMPT_CONFIG_TABLE = process.env.MULTI_PROMPT_CONFIG_TABLE || 'timtam-multi-prompt-config';
const CONTROL_SQS_URL = process.env.CONTROL_SQS_URL || '';

const ddbClient = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(ddbClient);
const sqs = new SQSClient({});

/**
 * PUT /orchestrator/multi-prompt-config
 * マルチプロンプト設定を更新
 * Body: { config: OrchestratorConfig }
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
    const config: OrchestratorConfig = body.config;

    // バリデーション
    if (!config || !config.prompts || !Array.isArray(config.prompts)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ok: false,
          error: 'config.prompts is required and must be an array',
        }),
      };
    }

    // プロンプトIDの重複チェック
    const ids = config.prompts.map((p) => p.id);
    const uniqueIds = new Set(ids);
    if (ids.length !== uniqueIds.size) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'Duplicate prompt IDs found' }),
      };
    }

    // 各プロンプトのバリデーション
    for (const prompt of config.prompts) {
      if (!prompt.id || !prompt.name || !prompt.promptText) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ok: false,
            error: 'Each prompt must have id, name, and promptText',
          }),
        };
      }

      if (!prompt.trigger || !prompt.trigger.type) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ok: false,
            error: 'Each prompt must have a trigger with type',
          }),
        };
      }
    }

    const updatedAt = Date.now();

    // DynamoDBに保存
    await ddb.send(
      new PutCommand({
        TableName: MULTI_PROMPT_CONFIG_TABLE,
        Item: {
          configKey: 'current_config',
          config,
          updatedAt,
        },
      })
    );

    // SQS経由でオーケストレーターに通知
    const controlMessage = {
      type: 'config',
      config,
    };

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: CONTROL_SQS_URL,
        MessageBody: JSON.stringify(controlMessage),
      })
    );

    console.log(
      JSON.stringify({
        type: 'multi-prompt.config.updated',
        promptCount: config.prompts.length,
        updatedAt,
      })
    );

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        config,
        updatedAt,
      }),
    };
  } catch (err: any) {
    console.error('[UpdateMultiPromptConfig] Error', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err?.message || 'Internal server error' }),
    };
  }
};
