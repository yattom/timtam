import { KinesisClient, GetShardIteratorCommand, GetRecordsCommand, DescribeStreamCommand } from '@aws-sdk/client-kinesis';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

// 環境変数
const STREAM_NAME = process.env.KINESIS_STREAM_NAME || 'timtam-asr';
const BEDROCK_REGION = process.env.BEDROCK_REGION || 'us-east-1';
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-haiku-4.5';
const AI_MESSAGES_TABLE = process.env.AI_MESSAGES_TABLE || 'timtam-ai-messages';
const CONFIG_TABLE_NAME = process.env.CONFIG_TABLE_NAME || 'timtam-orchestrator-config';
const DEFAULT_PROMPT = process.env.DEFAULT_PROMPT ||
  '会話の内容が具体的に寄りすぎていたり、抽象的になりすぎていたら指摘してください';
// MEETING_ID は SQS からの指示で動的変更する。初期値があればそれを使う。
let CURRENT_MEETING_ID = process.env.MEETING_ID || '';
// PROMPT は SQS からの指示で動的変更する。初期値は環境変数またはデフォルト。
let CURRENT_PROMPT = DEFAULT_PROMPT;
const WINDOW_LINES = Number(process.env.WINDOW_LINES || '5');
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || '500');
const CONTROL_SQS_URL = process.env.CONTROL_SQS_URL || '';
const MEETINGS_METADATA_TABLE = process.env.MEETINGS_METADATA_TABLE || 'timtam-meetings-metadata';
const MEETING_DURATION_MS = Number(process.env.MEETING_DURATION_MS || '3600000'); // デフォルト60分

type AsrEvent = {
  meetingId: string;
  speakerId?: string;
  text: string;
  isFinal: boolean;
  timestamp?: number; // epoch ms
  sequenceNumber?: string;
};

type TriggerResult = {
  should_intervene: boolean;
  reason: string;
  message: string;
};

class WindowBuffer {
  private lines: string[] = [];
  constructor(private maxLines: number) {}
  push(line: string) {
    if (!line) return;
    this.lines.push(line);
    while (this.lines.length > this.maxLines) this.lines.shift();
  }
  content(): string {
    return this.lines.join('\n');
  }
}

class Metrics {
  private cw = new CloudWatchClient({});
  async putLatencyMetric(name: string, ms: number) {
    try {
      await this.cw.send(new PutMetricDataCommand({
        Namespace: 'Timtam/Orchestrator',
        MetricData: [{ MetricName: name, Unit: 'Milliseconds', Value: ms }],
      }));
    } catch (e) {
      // PoC: 失敗は握り潰す
      console.warn('PutMetricData failed', name, (e as any)?.message);
    }
  }
  async putCountMetric(name: string, val = 1) {
    try {
      await this.cw.send(new PutMetricDataCommand({
        Namespace: 'Timtam/Orchestrator',
        MetricData: [{ MetricName: name, Unit: 'Count', Value: val }],
      }));
    } catch {}
  }
}

class TriggerLLM {
  private bedrock = new BedrockRuntimeClient({ region: BEDROCK_REGION });
  async judge(windowText: string, timeContext?: string): Promise<TriggerResult | null> {
    const timeContextStr = timeContext ? `\n${timeContext}\n` : '';
    const prompt =
      `以下は会議の直近確定発話です。\n` +
      CURRENT_PROMPT + `\n` +
      timeContextStr +
      `\n` +
      '介入が必要かを判断し、次のJSON形式だけを厳密に返してください:\n' +
      '{"should_intervene": boolean, "reason": string, "message": string}\n' +
      '---\n' + windowText;

    const payload: any = {
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      max_tokens: 500,
      temperature: 0.2,
    };
    if (String(BEDROCK_MODEL_ID).includes('anthropic')) {
      payload.anthropic_version = 'bedrock-2023-05-31';
    }
    const req: any = {
      body: JSON.stringify(payload),
      contentType: 'application/json',
      accept: 'application/json',
      modelId: BEDROCK_MODEL_ID,
    };
    const start = Date.now();
    const res = await this.bedrock.send(new InvokeModelCommand(req));
    const txt = new TextDecoder().decode(res.body as any);
    try {
      const parsed = JSON.parse(txt);
      // Anthropic on Bedrock (messages API) は {content:[{type:'text',text:'...'}]} 形式のことが多い
      // ただし 本PoCではJSONそのものを返すように指示しているため、直接JSONとして解釈できる経路を優先
      if (parsed && parsed.should_intervene !== undefined) return parsed as TriggerResult;
      // モデルにより content に入る場合へのフォールバック
      let embedded = parsed?.content?.[0]?.text;
      if (typeof embedded === 'string') {
        // Strip markdown code blocks if present (```json ... ```)
        embedded = embedded.replace(/^```json\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
        const e = JSON.parse(embedded);
        return e as TriggerResult;
      }
    } catch (e) {
      console.warn('LLM parse failed', (e as any)?.message, txt);
      return null;
    } finally {
      metrics.putLatencyMetric('LLM.InvokeLatency', Date.now() - start);
    }
    return null;
  }
}

class MeetingTimeTracker {
  private ddb: DynamoDBDocumentClient;
  private meetingStartTime: number | null = null;
  private lastHalfwayCheck = false;

  constructor() {
    const ddbClient = new DynamoDBClient({});
    this.ddb = DynamoDBDocumentClient.from(ddbClient);
  }

  async loadMeetingStartTime(meetingId: string): Promise<number | null> {
    try {
      const result = await this.ddb.send(
        new GetCommand({
          TableName: MEETINGS_METADATA_TABLE,
          Key: { meetingId },
        })
      );
      if (result.Item?.startedAt) {
        this.meetingStartTime = result.Item.startedAt;
        console.log(JSON.stringify({
          type: 'orchestrator.meeting.time.loaded',
          meetingId,
          startedAt: this.meetingStartTime,
          ts: Date.now()
        }));
        return this.meetingStartTime;
      }
    } catch (e) {
      console.warn('Failed to load meeting start time', (e as any)?.message);
    }
    return null;
  }

  getElapsedRatio(): number {
    if (!this.meetingStartTime) return 0;
    const elapsed = Date.now() - this.meetingStartTime;
    return Math.min(elapsed / MEETING_DURATION_MS, 1.0);
  }

  getCooldownMs(): number {
    const ratio = this.getElapsedRatio();
    if (ratio < 0.33) {
      return 10000; // 序盤: 10秒
    } else if (ratio < 0.66) {
      return 5000; // 中盤: 5秒
    } else {
      return 3000; // 終盤: 3秒
    }
  }

  getTimeContext(): string {
    const ratio = this.getElapsedRatio();
    const elapsedMin = Math.floor((Date.now() - (this.meetingStartTime || Date.now())) / 60000);
    const totalMin = Math.floor(MEETING_DURATION_MS / 60000);
    const remainingMin = Math.max(0, totalMin - elapsedMin);

    if (ratio < 0.33) {
      return `【会議時間】経過: ${elapsedMin}分 / 予定: ${totalMin}分 (序盤)`;
    } else if (ratio < 0.66) {
      return `【会議時間】経過: ${elapsedMin}分 / 予定: ${totalMin}分 / 残り: ${remainingMin}分 (中盤)`;
    } else {
      return `【会議時間】経過: ${elapsedMin}分 / 予定: ${totalMin}分 / 残り: ${remainingMin}分 (終盤・時間を意識してください)`;
    }
  }

  shouldCheckHalfway(): boolean {
    const ratio = this.getElapsedRatio();
    // 半分経過(0.48-0.52の範囲)で一度だけチェック
    if (ratio >= 0.48 && ratio <= 0.52 && !this.lastHalfwayCheck) {
      this.lastHalfwayCheck = true;
      return true;
    }
    return false;
  }

  getHalfwayPrompt(): string {
    const totalMin = Math.floor(MEETING_DURATION_MS / 60000);
    const remainingMin = Math.floor(totalMin / 2);
    return `会議時間が半分経過しました。残り${remainingMin}分で何が行えるか、参加者に確認を促してください。`;
  }
}

class Notifier {
  private ddb: DynamoDBDocumentClient;

  constructor() {
    const ddbClient = new DynamoDBClient({});
    this.ddb = DynamoDBDocumentClient.from(ddbClient);
  }

  async postChat(meetingId: string, message: string) {
    const timestamp = Date.now();
    const ttl = Math.floor(timestamp / 1000) + 86400; // Expire after 24 hours

    // Write to DynamoDB for web UI polling
    try {
      await this.ddb.send(
        new PutCommand({
          TableName: AI_MESSAGES_TABLE,
          Item: {
            meetingId,
            timestamp,
            message,
            ttl,
            type: 'ai_intervention',
          },
        })
      );
      console.log(JSON.stringify({
        type: 'chat.post',
        meetingId,
        message: message.substring(0, 100),
        timestamp,
        stored: 'dynamodb'
      }));
    } catch (err: any) {
      console.error('Failed to store AI message', {
        error: err?.message || err,
        meetingId,
      });
      // Still log to CloudWatch as fallback
      console.log(JSON.stringify({ type: 'chat.post', meetingId, message, ts: timestamp }));
    }
  }
}

const kinesis = new KinesisClient({});
const trigger = new TriggerLLM();
const notifier = new Notifier();
const metrics = new Metrics();
const sqs = new SQSClient({});
const timeTracker = new MeetingTimeTracker();

async function pollControlOnce() {
  if (!CONTROL_SQS_URL) return;
  try {
    const res = await sqs.send(new ReceiveMessageCommand({
      QueueUrl: CONTROL_SQS_URL,
      MaxNumberOfMessages: 5,
      WaitTimeSeconds: 0,
      VisibilityTimeout: 5,
    }));
    const msgs = res.Messages || [];
    for (const m of msgs) {
      const body = m.Body || '';
      try {
        const parsed = JSON.parse(body);

        // Handle prompt update messages
        if (parsed.type === 'prompt' && typeof parsed.prompt === 'string') {
          CURRENT_PROMPT = parsed.prompt;
          console.log(JSON.stringify({
            type: 'orchestrator.control.prompt.set',
            promptLength: CURRENT_PROMPT.length,
            promptPreview: CURRENT_PROMPT.substring(0, 50),
            ts: Date.now()
          }));
        }

        // Handle meetingId messages (both new and legacy format)
        if (parsed.type === 'meetingId' || (parsed.meetingId && !parsed.type)) {
          CURRENT_MEETING_ID = parsed.meetingId;
          console.log(JSON.stringify({ type: 'orchestrator.control.meeting.set', meetingId: CURRENT_MEETING_ID, ts: Date.now() }));
          // Load meeting start time for time-based intervention
          await timeTracker.loadMeetingStartTime(CURRENT_MEETING_ID);
        }
      } catch {
        // ignore
      }
      if (m.ReceiptHandle) {
        await sqs.send(new DeleteMessageCommand({ QueueUrl: CONTROL_SQS_URL, ReceiptHandle: m.ReceiptHandle }));
      }
    }
  } catch (e) {
    console.warn('control poll failed', (e as any)?.message);
  }
}

async function getShardIterator(streamName: string): Promise<string> {
  const desc = await kinesis.send(new DescribeStreamCommand({ StreamName: streamName }));
  const shardId = desc.StreamDescription?.Shards?.[0]?.ShardId;
  if (!shardId) throw new Error('No shard found in stream');
  const it = await kinesis.send(new GetShardIteratorCommand({
    StreamName: streamName,
    ShardId: shardId,
    ShardIteratorType: 'LATEST',
  }));
  if (!it.ShardIterator) throw new Error('Failed to get shard iterator');
  return it.ShardIterator;
}

async function runLoop() {
  console.log(JSON.stringify({
    type: 'orchestrator.loop.config',
    POLL_INTERVAL_MS,
    WINDOW_LINES,
    STREAM_NAME,
    MEETING_DURATION_MS,
    ts: Date.now()
  }));
  if (!CURRENT_MEETING_ID) console.warn('CURRENT_MEETING_ID is empty. All events will be processed; set via CONTROL_SQS_URL or MEETING_ID env to restrict.');

  // Load meeting start time if CURRENT_MEETING_ID is set
  if (CURRENT_MEETING_ID) {
    await timeTracker.loadMeetingStartTime(CURRENT_MEETING_ID);
  }

  let shardIterator = await getShardIterator(STREAM_NAME);
  const window = new WindowBuffer(WINDOW_LINES);
  let consecutiveErrors = 0;
  let loopCount = 0;
  let lastLLMCallTime = 0;
  for (;;) {
    try {
      // control plane (non-blocking)
      await pollControlOnce();
      const t0 = Date.now();
      loopCount++;
      const recs = await kinesis.send(new GetRecordsCommand({ ShardIterator: shardIterator, Limit: 100 }));
      shardIterator = recs.NextShardIterator!;
      const list = recs.Records || [];

      // Log periodically (heartbeat) or when we receive records
      if (loopCount % 1000 === 0 || list.length > 0) {
        console.log(JSON.stringify({
          type: 'orchestrator.loop.poll',
          loopCount,
          recordCount: list.length,
          consecutiveErrors,
          ts: Date.now()
        }));
      }
      for (const r of list) {
        const dataStr = r.Data ? new TextDecoder().decode(r.Data as any) : '';
        let ev: AsrEvent | null = null;
        try { ev = JSON.parse(dataStr); } catch {}
        if (!ev) continue;
        if (CURRENT_MEETING_ID && ev.meetingId !== CURRENT_MEETING_ID) continue;
        if (!ev.isFinal) continue; // finalのみ

        // final文をウィンドウに追加
        // Include speaker information if available
        const speakerPrefix = ev.speakerId ? `[${ev.speakerId}] ` : '';
        window.push(speakerPrefix + ev.text);

        // Log speaker information for debugging
        if (ev.speakerId) {
          console.log(JSON.stringify({
            type: 'orchestrator.transcript.speaker',
            meetingId: ev.meetingId,
            speakerId: ev.speakerId,
            textLength: ev.text.length,
            ts: Date.now()
          }));
        }

        // 半分経過チェック
        if (timeTracker.shouldCheckHalfway()) {
          const halfwayPrompt = timeTracker.getHalfwayPrompt();
          console.log(JSON.stringify({
            type: 'orchestrator.meeting.halfway',
            meetingId: ev.meetingId,
            ts: Date.now()
          }));
          // 半分経過時の特別な介入
          await notifier.postChat(ev.meetingId, halfwayPrompt);
        }

        // トリガー判定 (Rate limiting: only call LLM if cooldown has passed)
        // クールダウン時間を経過時間に応じて動的に変更
        const LLM_COOLDOWN_MS = timeTracker.getCooldownMs();
        const now = Date.now();
        if (now - lastLLMCallTime >= LLM_COOLDOWN_MS) {
          const winText = window.content();
          const timeContext = timeTracker.getTimeContext();
          const judgeStart = Date.now();
          const res = await trigger.judge(winText, timeContext);
          lastLLMCallTime = Date.now();
          await metrics.putLatencyMetric('ASRToDecisionLatency', Date.now() - (ev.timestamp || judgeStart));

          if (res && res.should_intervene) {
            await notifier.postChat(ev.meetingId, res.message);
          }
        } else {
          console.log(JSON.stringify({
            type: 'orchestrator.llm.skipped',
            reason: 'cooldown',
            timeSinceLastCall: now - lastLLMCallTime,
            cooldownMs: LLM_COOLDOWN_MS,
            ts: now
          }));
        }
        consecutiveErrors = 0;
      }
      // ポーリング間隔とE2Eメトリクス
      const dt = Date.now() - t0;
      const sleepTime = Math.max(0, POLL_INTERVAL_MS - dt);
      if (sleepTime > 0) await new Promise((s) => setTimeout(s, sleepTime));
    } catch (e) {
      consecutiveErrors++;
      const errorMsg = (e as any)?.message || String(e);
      console.error(JSON.stringify({
        type: 'orchestrator.loop.error',
        error: errorMsg,
        consecutiveErrors,
        loopCount,
        ts: Date.now()
      }));
      await metrics.putCountMetric('Errors', 1);
      if (consecutiveErrors > 10) {
        console.error(JSON.stringify({
          type: 'orchestrator.loop.backoff',
          consecutiveErrors,
          backoffMs: 2000,
          ts: Date.now()
        }));
        await new Promise((s) => setTimeout(s, 2000));
      }
    }
  }
}

// Initialize prompt from DynamoDB
async function initializePrompt() {
  try {
    const ddbClient = new DynamoDBClient({ region: BEDROCK_REGION });
    const ddb = DynamoDBDocumentClient.from(ddbClient);
    const result = await ddb.send(new GetCommand({
      TableName: CONFIG_TABLE_NAME,
      Key: { configKey: 'current_prompt' }
    }));
    if (result.Item?.prompt) {
      CURRENT_PROMPT = result.Item.prompt;
      console.log(JSON.stringify({
        type: 'orchestrator.config.prompt.loaded',
        promptLength: CURRENT_PROMPT.length,
        promptPreview: CURRENT_PROMPT.substring(0, 50),
        ts: Date.now()
      }));
    } else {
      console.log(JSON.stringify({
        type: 'orchestrator.config.prompt.default',
        promptLength: CURRENT_PROMPT.length,
        promptPreview: CURRENT_PROMPT.substring(0, 50),
        ts: Date.now()
      }));
    }
  } catch (e) {
    console.warn('Failed to load prompt from DynamoDB, using default', (e as any)?.message);
  }
}

// エントリ
console.log(JSON.stringify({
  type: 'orchestrator.worker.start',
  ts: Date.now(),
  env: { STREAM_NAME, BEDROCK_REGION, BEDROCK_MODEL_ID, CURRENT_MEETING_ID, CONTROL_SQS_URL, CONFIG_TABLE_NAME }
}));

(async () => {
  await initializePrompt();
  await runLoop();
})().catch((e) => {
  console.error('worker fatal', e);
  process.exit(1);
});
