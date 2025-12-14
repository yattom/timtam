import { KinesisClient, GetShardIteratorCommand, GetRecordsCommand, DescribeStreamCommand } from '@aws-sdk/client-kinesis';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';

// 環境変数
const STREAM_NAME = process.env.KINESIS_STREAM_NAME || 'timtam-asr';
const BEDROCK_REGION = process.env.BEDROCK_REGION || 'us-east-1';
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-haiku-4.5';
// MEETING_ID は SQS からの指示で動的変更する。初期値があればそれを使う。
let CURRENT_MEETING_ID = process.env.MEETING_ID || '';
const WINDOW_LINES = Number(process.env.WINDOW_LINES || '5');
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || '200');
const CONTROL_SQS_URL = process.env.CONTROL_SQS_URL || '';

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
  async judge(windowText: string, policy = '控えめ・確認優先'): Promise<TriggerResult | null> {
    const prompt =
      `以下は会議の直近確定発話です。プロンプト方針: ${policy}\n` +
      '介入が必要かを判断し、次のJSON形式だけを厳密に返してください:\n' +
      '{"should_intervene": boolean, "reason": string, "message": string}\n' +
      '---\n' + windowText;

    const payload: any = {
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      max_tokens: 200,
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
      const embedded = parsed?.content?.[0]?.text;
      if (typeof embedded === 'string') {
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

class Notifier {
  // Phase 1: チャット投稿の代替としてログ出力
  async postChat(meetingId: string, message: string) {
    console.log(JSON.stringify({ type: 'chat.post', meetingId, message, ts: Date.now() }));
  }
}

const kinesis = new KinesisClient({});
const trigger = new TriggerLLM();
const notifier = new Notifier();
const metrics = new Metrics();
const sqs = new SQSClient({});

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
        if (parsed && typeof parsed.meetingId === 'string') {
          CURRENT_MEETING_ID = parsed.meetingId;
          console.log(JSON.stringify({ type: 'orchestrator.control.meeting.set', meetingId: CURRENT_MEETING_ID, ts: Date.now() }));
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
  if (!CURRENT_MEETING_ID) console.warn('CURRENT_MEETING_ID is empty. All events will be processed; set via CONTROL_SQS_URL or MEETING_ID env to restrict.');
  let shardIterator = await getShardIterator(STREAM_NAME);
  const window = new WindowBuffer(WINDOW_LINES);
  let consecutiveErrors = 0;
  for (;;) {
    try {
      // control plane (non-blocking)
      await pollControlOnce();
      const t0 = Date.now();
      const recs = await kinesis.send(new GetRecordsCommand({ ShardIterator: shardIterator, Limit: 100 }));
      shardIterator = recs.NextShardIterator!;
      const list = recs.Records || [];
      for (const r of list) {
        const dataStr = r.Data ? new TextDecoder().decode(r.Data as any) : '';
        let ev: AsrEvent | null = null;
        try { ev = JSON.parse(dataStr); } catch {}
        if (!ev) continue;
        if (CURRENT_MEETING_ID && ev.meetingId !== CURRENT_MEETING_ID) continue;
        if (!ev.isFinal) continue; // finalのみ

        // final文をウィンドウに追加
        window.push(ev.text);

        // トリガー判定
        const winText = window.content();
        const judgeStart = Date.now();
        const res = await trigger.judge(winText);
        await metrics.putLatencyMetric('ASRToDecisionLatency', Date.now() - (ev.timestamp || judgeStart));

        if (res && res.should_intervene) {
          await notifier.postChat(ev.meetingId, res.message);
        }
        consecutiveErrors = 0;
      }
      // ポーリング間隔とE2Eメトリクス
      const dt = Date.now() - t0;
      if (dt < POLL_INTERVAL_MS) await new Promise((s) => setTimeout(s, POLL_INTERVAL_MS - dt));
    } catch (e) {
      consecutiveErrors++;
      console.error('orchestrator loop error', (e as any)?.message);
      await metrics.putCountMetric('Errors', 1);
      if (consecutiveErrors > 10) {
        console.error('Too many consecutive errors, backing off');
        await new Promise((s) => setTimeout(s, 2000));
      }
    }
  }
}

// エントリ
runLoop().catch((e) => {
  console.error('worker fatal', e);
  process.exit(1);
});
