import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { createHash } from 'crypto';
import { RecallAdapter } from '@timtam/shared';

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const TRANSCRIPT_QUEUE_URL = process.env.TRANSCRIPT_QUEUE_URL || '';
const AI_MESSAGES_TABLE = process.env.AI_MESSAGES_TABLE || 'timtam-ai-messages';
const RECALL_API_KEY = process.env.RECALL_API_KEY || '';

const sqs = new SQSClient({ region: REGION });

// RecallAdapter for INBOUND processing (Recall.ai Webhook format → TranscriptEvent)
const recallAdapter = new RecallAdapter({
  apiKey: RECALL_API_KEY,
  aiMessagesTable: AI_MESSAGES_TABLE, // Lambda側では使わないが、必須パラメータ
});

/**
 * POST /recall/webhook
 *
 * Recall.ai Webhookハンドラー
 * - リアルタイム文字起こしイベントを受信
 * - RecallAdapterでTranscriptEventに変換
 * - SQS FIFOキューに送信
 *
 * Webhook types:
 * - transcript: リアルタイム文字起こし
 * - participant.join: 参加者参加
 * - participant.leave: 参加者退出
 * - bot.status: ボット状態変化
 *
 * @see https://docs.recall.ai/docs/real-time-webhook-endpoints
 */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    if (!event.body) {
      console.error('Recall webhook received empty body');
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true }),
      };
    }

    let payload: any;
    try {
      payload = JSON.parse(event.body);
    } catch (parseError) {
      console.error('Failed to parse Recall webhook request body as JSON', {
        errorMessage: (parseError as Error).message,
      });
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true }),
      };
    }
    const { event: eventType } = payload;

    console.log(JSON.stringify({
      type: 'recall.webhook.received',
      eventType,
      botId: payload.bot_id,
      timestamp: Date.now(),
    }));

    // Webhook signature verification (TODO: Phase 2.2)
    // const signature = event.headers['x-recall-signature'];
    // if (!verifyWebhookSignature(event.body, signature)) {
    //   return { statusCode: 401, body: JSON.stringify({ error: 'Invalid signature' }) };
    // }

    switch (eventType) {
      case 'transcript.data':
        return await handleTranscriptEvent(payload);

      case 'participant.join':
      case 'participant.leave':
        // Phase 2: 参加者イベント処理（後回し）
        console.log(JSON.stringify({
          type: 'recall.webhook.participant',
          eventType,
          participantId: payload.participant?.id,
        }));
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ok: true, message: 'Participant event acknowledged (not processed)' }),
        };

      case 'bot.status':
        // Phase 2: ボット状態変化イベント（後回し）
        console.log(JSON.stringify({
          type: 'recall.webhook.bot_status',
          botId: payload.bot_id,
          status: payload.status,
        }));
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ok: true, message: 'Bot status event acknowledged (not processed)' }),
        };

      default:
        console.warn(`Unknown Recall.ai event type: ${eventType}`);
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ok: true, message: 'Unknown event type' }),
        };
    }
  } catch (err: any) {
    console.error('Error processing Recall.ai webhook', {
      error: err?.message || err,
      stack: err?.stack,
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    };
  }
};

/**
 * リアルタイム文字起こしイベント処理
 */
async function handleTranscriptEvent(payload: any): Promise<any> {
  const bot_id = payload.data?.bot?.id;
  const words = payload.data?.data?.words;
  const participant = payload.data?.data?.participant;

  if (!bot_id || !words || !participant) {
    console.error('Missing required fields in Recall.ai webhook payload', {
      hasBotId: !!bot_id,
      hasWords: !!words,
      hasParticipant: !!participant,
    });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    };
  }

  const transcriptEvent = recallAdapter.processInboundTranscript(payload);

  // MessageDeduplicationIdを生成
  // transcript.idとparticipant.idとwords[0]のtimestampを組み合わせてユニークなIDを作成
  const transcript_id = payload.data?.transcript?.id || 'unknown';
  const participant_id = participant.id || 'unknown';
  const first_word_timestamp = words[0]?.start_timestamp?.relative || Date.now();

  const deduplicationId = createHash('sha256')
    .update(`${bot_id}:${transcript_id}:${participant_id}:${first_word_timestamp}`)
    .digest('hex')
    .substring(0, 128); // AWS制限: 最大128文字

  // MessageGroupId = botId（Recall.aiでは1ボット=1会議）
  const messageGroupId = bot_id;

  // SQS FIFOキューに送信
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: TRANSCRIPT_QUEUE_URL,
      MessageBody: JSON.stringify(transcriptEvent),
      MessageDeduplicationId: deduplicationId,
      MessageGroupId: messageGroupId,
    })
  );

  console.log(JSON.stringify({
    type: 'recall.transcript.forwarded',
    botId: bot_id,
    speakerId: participant?.id || participant?.name,
    textLength: words?.length || 0,
    transcriptId: transcript_id,
    deduplicationId,
  }));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true }),
  };
}

/**
 * Webhook署名検証（TODO: Phase 2.2で実装）
 *
 * @see https://docs.recall.ai/reference/webhooks-overview#webhook-signature-verification
 */
function verifyWebhookSignature(body: string, signature?: string): boolean {
  // TODO: Recall.ai Webhook署名検証
  // - X-Recall-Signature ヘッダー
  // - HMAC-SHA256でペイロードをハッシュ化
  // - Secrets ManagerからWebhook secretを取得
  return true; // 暫定的にtrue（セキュリティ警告）
}
