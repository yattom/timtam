import { APIGatewayProxyHandlerV2 } from 'aws-lambda';

// 公開してよい設定のみを返す（Secretsは含めない）
const API_BASE_URL = process.env.API_BASE_URL || '';
const DEFAULT_BEDROCK_REGION = process.env.DEFAULT_BEDROCK_REGION || 'ap-northeast-1';
const DEFAULT_MODEL_ID = process.env.DEFAULT_MODEL_ID || '';
const TTS_DEFAULT_VOICE = process.env.TTS_DEFAULT_VOICE || 'Mizuki';

export const handler: APIGatewayProxyHandlerV2 = async () => {
  const body = {
    apiBaseUrl: API_BASE_URL,
    defaultRegion: DEFAULT_BEDROCK_REGION,
    defaultModelId: DEFAULT_MODEL_ID,
    ttsDefaultVoice: TTS_DEFAULT_VOICE,
  };
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
};
