import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const TTS_DEFAULT_VOICE = process.env.TTS_DEFAULT_VOICE || 'Mizuki';
const polly = new PollyClient({ region: REGION });

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const text: string | undefined = body.text;
    const voiceId: string = body.voiceId || TTS_DEFAULT_VOICE;
    const format: 'mp3' | 'ogg_vorbis' | 'pcm' = body.format || 'mp3';

    if (!text || typeof text !== 'string' || !text.trim()) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'text is required' }),
      };
    }

    const res = await polly.send(
      new SynthesizeSpeechCommand({
        OutputFormat: format,
        Text: text,
        VoiceId: voiceId,
      })
    );

    const bytes = await (res.AudioStream as any)?.transformToByteArray?.();
    if (!bytes) {
      throw new Error('Polly returned empty audio');
    }

    const contentType = format === 'mp3' ? 'audio/mpeg' : format === 'ogg_vorbis' ? 'audio/ogg' : 'audio/wave';
    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: { 'Content-Type': contentType },
      body: Buffer.from(bytes).toString('base64'),
    };
  } catch (err: any) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err?.message || String(err) }),
    };
  }
};
