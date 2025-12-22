import { KinesisClient, GetShardIteratorCommand, GetRecordsCommand, DescribeStreamCommand } from '@aws-sdk/client-kinesis';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { MultiPromptEngine } from './multi-prompt-engine';
import { OrchestratorConfig, PromptExecutionResult } from './multi-prompt-types';

// 環境変数
const STREAM_NAME = process.env.KINESIS_STREAM_NAME || 'timtam-asr';
const BEDROCK_REGION = process.env.BEDROCK_REGION || 'us-east-1';
const AI_MESSAGES_TABLE = process.env.AI_MESSAGES_TABLE || 'timtam-ai-messages';
const CONFIG_TABLE_NAME = process.env.CONFIG_TABLE_NAME || 'timtam-orchestrator-config';
const MULTI_PROMPT_CONFIG_TABLE = process.env.MULTI_PROMPT_CONFIG_TABLE || 'timtam-multi-prompt-config';
const PROMPT_STATES_TABLE = process.env.PROMPT_STATES_TABLE || 'timtam-prompt-states';
let CURRENT_MEETING_ID = process.env.MEETING_ID || '';
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || '500');
const CONTROL_SQS_URL = process.env.CONTROL_SQS_URL || '';

type AsrEvent = {
  meetingId: string;
  speakerId?: string;
  text: string;
  isFinal: boolean;
  timestamp?: number;
  sequenceNumber?: string;
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
  setMaxLines(n: number) {
    this.maxLines = n;
    while (this.lines.length > this.maxLines) this.lines.shift();
  }
}

class Metrics {
  private cw = new CloudWatchClient({});
  async putLatencyMetric(name: string, ms: number) {
    try {
      await this.cw.send(
        new PutMetricDataCommand({
          Namespace: 'Timtam/MultiPrompt',
          MetricData: [{ MetricName: name, Unit: 'Milliseconds', Value: ms }],
        })
      );
    } catch (e) {
      console.warn('PutMetricData failed', name, (e as any)?.message);
    }
  }
  async putCountMetric(name: string, val = 1) {
    try {
      await this.cw.send(
        new PutMetricDataCommand({
          Namespace: 'Timtam/MultiPrompt',
          MetricData: [{ MetricName: name, Unit: 'Count', Value: val }],
        })
      );
    } catch {}
  }
}

class Notifier {
  private ddb: DynamoDBDocumentClient;

  constructor() {
    const ddbClient = new DynamoDBClient({});
    this.ddb = DynamoDBDocumentClient.from(ddbClient);
  }

  async postChat(meetingId: string, message: string, promptId?: string) {
    const timestamp = Date.now();
    const ttl = Math.floor(timestamp / 1000) + 86400; // 24時間後に期限切れ

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
            promptId: promptId || 'unknown',
          },
        })
      );
      console.log(
        JSON.stringify({
          type: 'multi-prompt.chat.post',
          meetingId,
          promptId,
          messageLength: message.length,
          timestamp,
        })
      );
    } catch (err: any) {
      console.error('Failed to store AI message', {
        error: err?.message || err,
        meetingId,
        promptId,
      });
    }
  }

  async savePromptStates(meetingId: string, states: Map<string, any>) {
    const timestamp = Date.now();
    const ttl = Math.floor(timestamp / 1000) + 86400;

    try {
      await this.ddb.send(
        new PutCommand({
          TableName: PROMPT_STATES_TABLE,
          Item: {
            meetingId,
            timestamp,
            states: Object.fromEntries(states),
            ttl,
          },
        })
      );
    } catch (err: any) {
      console.error('Failed to save prompt states', err?.message || err);
    }
  }
}

const kinesis = new KinesisClient({});
const notifier = new Notifier();
const metrics = new Metrics();
const sqs = new SQSClient({});
const ddbClient = new DynamoDBClient({ region: BEDROCK_REGION });
const ddb = DynamoDBDocumentClient.from(ddbClient);

let multiPromptEngine: MultiPromptEngine | null = null;

// デフォルト設定
const DEFAULT_CONFIG: OrchestratorConfig = {
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
    bedrockRegion: BEDROCK_REGION,
  },
};

async function loadMultiPromptConfig(): Promise<OrchestratorConfig> {
  try {
    const result = await ddb.send(
      new GetCommand({
        TableName: MULTI_PROMPT_CONFIG_TABLE,
        Key: { configKey: 'current_config' },
      })
    );

    if (result.Item?.config) {
      console.log(
        JSON.stringify({
          type: 'multi-prompt.config.loaded',
          promptCount: result.Item.config.prompts?.length || 0,
          ts: Date.now(),
        })
      );
      return result.Item.config as OrchestratorConfig;
    }
  } catch (e) {
    console.warn('Failed to load multi-prompt config, using default', (e as any)?.message);
  }

  return DEFAULT_CONFIG;
}

async function pollControlOnce() {
  if (!CONTROL_SQS_URL) return;
  try {
    const res = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: CONTROL_SQS_URL,
        MaxNumberOfMessages: 5,
        WaitTimeSeconds: 0,
        VisibilityTimeout: 5,
      })
    );
    const msgs = res.Messages || [];
    for (const m of msgs) {
      const body = m.Body || '';
      try {
        const parsed = JSON.parse(body);

        // 会議ID更新
        if (parsed.type === 'meetingId' || (parsed.meetingId && !parsed.type)) {
          CURRENT_MEETING_ID = parsed.meetingId;
          console.log(
            JSON.stringify({
              type: 'multi-prompt.control.meeting.set',
              meetingId: CURRENT_MEETING_ID,
              ts: Date.now(),
            })
          );
        }

        // 設定更新
        if (parsed.type === 'config' && parsed.config) {
          const newConfig = parsed.config as OrchestratorConfig;
          if (multiPromptEngine) {
            multiPromptEngine.updateConfig(newConfig);
            console.log(
              JSON.stringify({
                type: 'multi-prompt.control.config.updated',
                promptCount: newConfig.prompts.length,
                ts: Date.now(),
              })
            );
          }
        }
      } catch {
        // ignore
      }
      if (m.ReceiptHandle) {
        await sqs.send(
          new DeleteMessageCommand({
            QueueUrl: CONTROL_SQS_URL,
            ReceiptHandle: m.ReceiptHandle,
          })
        );
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
  const it = await kinesis.send(
    new GetShardIteratorCommand({
      StreamName: streamName,
      ShardId: shardId,
      ShardIteratorType: 'LATEST',
    })
  );
  if (!it.ShardIterator) throw new Error('Failed to get shard iterator');
  return it.ShardIterator;
}

async function runLoop() {
  console.log(
    JSON.stringify({
      type: 'multi-prompt.loop.config',
      POLL_INTERVAL_MS,
      STREAM_NAME,
      ts: Date.now(),
    })
  );

  if (!CURRENT_MEETING_ID)
    console.warn(
      'CURRENT_MEETING_ID is empty. All events will be processed; set via CONTROL_SQS_URL or MEETING_ID env to restrict.'
    );

  // マルチプロンプト設定をロード
  const config = await loadMultiPromptConfig();
  multiPromptEngine = new MultiPromptEngine(config, BEDROCK_REGION);

  let shardIterator = await getShardIterator(STREAM_NAME);
  const window = new WindowBuffer(config.globalSettings.windowLines);
  let consecutiveErrors = 0;
  let loopCount = 0;

  for (;;) {
    try {
      await pollControlOnce();
      const t0 = Date.now();
      loopCount++;
      const recs = await kinesis.send(
        new GetRecordsCommand({ ShardIterator: shardIterator, Limit: 100 })
      );
      shardIterator = recs.NextShardIterator!;
      const list = recs.Records || [];

      if (loopCount % 1000 === 0 || list.length > 0) {
        console.log(
          JSON.stringify({
            type: 'multi-prompt.loop.poll',
            loopCount,
            recordCount: list.length,
            consecutiveErrors,
            ts: Date.now(),
          })
        );
      }

      for (const r of list) {
        const dataStr = r.Data ? new TextDecoder().decode(r.Data as any) : '';
        let ev: AsrEvent | null = null;
        try {
          ev = JSON.parse(dataStr);
        } catch {}
        if (!ev) continue;
        if (CURRENT_MEETING_ID && ev.meetingId !== CURRENT_MEETING_ID) continue;
        if (!ev.isFinal) continue; // finalのみ

        // ウィンドウに追加
        const speakerPrefix = ev.speakerId ? `[${ev.speakerId}] ` : '';
        window.push(speakerPrefix + ev.text);

        if (ev.speakerId) {
          console.log(
            JSON.stringify({
              type: 'multi-prompt.transcript.speaker',
              meetingId: ev.meetingId,
              speakerId: ev.speakerId,
              textLength: ev.text.length,
              ts: Date.now(),
            })
          );
        }

        // マルチプロンプトエンジンで処理
        if (multiPromptEngine) {
          const winText = window.content();
          const processStart = Date.now();
          const results = await multiPromptEngine.processTranscript(winText, ev.meetingId);
          await metrics.putLatencyMetric(
            'ProcessTranscriptLatency',
            Date.now() - processStart
          );

          // 結果を処理
          for (const result of results) {
            if (result.shouldIntervene && result.output) {
              await notifier.postChat(ev.meetingId, result.output, result.promptId);
            }
          }

          // 状態を定期的に保存
          if (loopCount % 100 === 0) {
            await notifier.savePromptStates(ev.meetingId, multiPromptEngine.getAllStates());
          }
        }

        consecutiveErrors = 0;
      }

      const dt = Date.now() - t0;
      const sleepTime = Math.max(0, POLL_INTERVAL_MS - dt);
      if (sleepTime > 0) await new Promise((s) => setTimeout(s, sleepTime));
    } catch (e) {
      consecutiveErrors++;
      const errorMsg = (e as any)?.message || String(e);
      console.error(
        JSON.stringify({
          type: 'multi-prompt.loop.error',
          error: errorMsg,
          consecutiveErrors,
          loopCount,
          ts: Date.now(),
        })
      );
      await metrics.putCountMetric('Errors', 1);
      if (consecutiveErrors > 10) {
        console.error(
          JSON.stringify({
            type: 'multi-prompt.loop.backoff',
            consecutiveErrors,
            backoffMs: 2000,
            ts: Date.now(),
          })
        );
        await new Promise((s) => setTimeout(s, 2000));
      }
    }
  }
}

// エントリ
console.log(
  JSON.stringify({
    type: 'multi-prompt.worker.start',
    ts: Date.now(),
    env: {
      STREAM_NAME,
      BEDROCK_REGION,
      CURRENT_MEETING_ID,
      CONTROL_SQS_URL,
      MULTI_PROMPT_CONFIG_TABLE,
    },
  })
);

runLoop().catch((e) => {
  console.error('multi-prompt worker fatal', e);
  process.exit(1);
});
