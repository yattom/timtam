import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

// 環境変数でモデルを切り替え可能に（デフォルトはHaiku 4.5想定）
const BEDROCK_REGION = process.env.BEDROCK_REGION || 'us-east-1';
const MODEL_ID = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-haiku-4.5';

const bedrock = new BedrockRuntimeClient({ region: BEDROCK_REGION });

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const windowText: string = body.windowText || '';
    const policy: string = body.policy || '控えめ・確認優先';
    const prompt =
      `以下は会議の直近発話です。プロンプト方針: ${policy}\n` +
      '介入が必要かを判断し、次のJSON形式だけを厳密に返してください:\n' +
      '{"should_intervene": boolean, "reason": string, "message": string}\n' +
      '---\n' + windowText;

    const payload = {
      messages: [
        { role: 'user', content: [{ type: 'text', text: prompt }] },
      ],
      max_tokens: 200,
      temperature: 0.2,
    } as any;

    const res = await bedrock.send(
      new InvokeModelCommand({ modelId: MODEL_ID, body: JSON.stringify(payload) })
    );
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
