import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

// 環境変数でモデル/プロファイルを切り替え可能に
const BEDROCK_REGION = process.env.BEDROCK_REGION || 'us-east-1';
const DEFAULT_MODEL_ID = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-haiku-4.5';
const DEFAULT_INF_PROFILE_ARN = process.env.BEDROCK_INFERENCE_PROFILE_ARN || '';
const DEFAULT_INF_PROFILE_ID = process.env.BEDROCK_INFERENCE_PROFILE_ID || '';

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const windowText: string = body.windowText || '';
    const policy: string = body.policy || '控えめ・確認優先';
    const region: string = body.region || BEDROCK_REGION;
    const bedrock = new BedrockRuntimeClient({ region });
    const modelId: string | undefined = body.modelId || DEFAULT_MODEL_ID || undefined;
    const inferenceProfileArn: string | undefined = body.inferenceProfileArn || DEFAULT_INF_PROFILE_ARN || undefined;
    const inferenceProfileId: string | undefined = body.inferenceProfileId || DEFAULT_INF_PROFILE_ID || undefined;
    const prompt =
      `以下は会議の直近発話です。プロンプト方針: ${policy}\n` +
      '介入が必要かを判断し、次のJSON形式だけを厳密に返してください:\n' +
      '{"should_output": boolean, "reason": string, "message": string}\n' +
      '---\n' + windowText;

    const payload: any = {
      messages: [
        { role: 'user', content: [{ type: 'text', text: prompt }] },
      ],
      max_tokens: 500,
      temperature: 0.2,
    };

    // Anthropic models on Bedrock require anthropic_version
    const idStr = `${inferenceProfileArn || inferenceProfileId || modelId || ''}`;
    if (idStr.includes('anthropic')) {
      payload.anthropic_version = 'bedrock-2023-05-31';
    }

    const req: any = {
      body: JSON.stringify(payload),
      contentType: 'application/json',
      accept: 'application/json',
    };
    if (inferenceProfileArn) {
      req.inferenceProfileArn = inferenceProfileArn;
    } else if (inferenceProfileId) {
      req.inferenceProfileId = inferenceProfileId;
    } else if (modelId) {
      req.modelId = modelId;
    } else {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'No Bedrock model identifier provided (inferenceProfileArn/inferenceProfileId/modelId).' }),
      };
    }

    const res = await bedrock.send(new InvokeModelCommand(req));
    const txt = new TextDecoder().decode(res.body as any);
    let parsed: any;
    try {
      parsed = JSON.parse(txt);
    } catch {
      // 失敗時は素のテキストを包んで返す
      parsed = { raw: txt };
    }
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed) };
  } catch (err: any) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err?.message || String(err) }),
    };
  }
};
