import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import {
  WindowBuffer,
  Notebook,
  NotesStore,
  GraspQueue,
  Grasp,
  GraspConfig,
  Note,
  TriggerResult,
  JudgeResult,
  LLMClient,
  Notifier as INotifier,
  Metrics as IMetrics
} from './grasp';
import { parseGraspGroupDefinition, GraspGroupDefinition } from './graspConfigParser';
import { ensureDefaultGraspConfig } from './selfSetup';
import { Message } from '@aws-sdk/client-sqs';

// 環境変数
const TRANSCRIPT_QUEUE_URL = process.env.TRANSCRIPT_QUEUE_URL || '';
const BEDROCK_REGION = process.env.BEDROCK_REGION || 'us-east-1';
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-haiku-4.5';
const AI_MESSAGES_TABLE = process.env.AI_MESSAGES_TABLE || 'timtam-ai-messages';
const CONFIG_TABLE_NAME = process.env.CONFIG_TABLE_NAME || 'timtam-orchestrator-config';
// MEETING_ID は SQS からの指示で動的変更する。初期値があればそれを使う。
let CURRENT_MEETING_ID = process.env.MEETING_ID || '';
const WINDOW_LINES = Number(process.env.WINDOW_LINES || '5');
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || '500');
const CONTROL_SQS_URL = process.env.CONTROL_SQS_URL || '';

type AsrEvent = {
  meetingId: string;
  speakerId?: string;
  text: string;
  isFinal: boolean;
  timestamp?: number; // epoch ms
  sequenceNumber?: string;
};

class Metrics implements IMetrics {
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

class TriggerLLM implements LLMClient {
  private bedrock = new BedrockRuntimeClient({ region: BEDROCK_REGION });

  // 汎用的なLLM呼び出しメソッド
  async invoke(prompt: string, nodeId: string): Promise<JudgeResult> {
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
    let result: TriggerResult | null = null;
    try {
      const parsed = JSON.parse(txt);
      // Anthropic on Bedrock (messages API) は {content:[{type:'text',text:'...'}]} 形式のことが多い
      // ただし 本PoCではJSONそのものを返すように指示しているため、直接JSONとして解釈できる経路を優先
      if (parsed && parsed.should_intervene !== undefined) {
        result = parsed as TriggerResult;
      } else {
        // モデルにより content に入る場合へのフォールバック
        let embedded = parsed?.content?.[0]?.text;
        if (typeof embedded === 'string') {
          // Strip markdown code blocks if present (```json ... ```)
          embedded = embedded.replace(/^```json\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
          const e = JSON.parse(embedded);
          result = e as TriggerResult;
        }
      }
    } catch (e) {
      console.warn('LLM parse failed', (e as any)?.message, txt);
    } finally {
      metrics.putLatencyMetric(`LLM.${nodeId}.InvokeLatency`, Date.now() - start);
    }
    return { result, prompt, rawResponse: txt };
  }
}

class Notifier implements INotifier {
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

  async postLlmCallLog(meetingId: string, prompt: string, rawResponse: string, nodeId: string = 'default') {
    const timestamp = Date.now();
    const ttl = Math.floor(timestamp / 1000) + 86400; // Expire after 24 hours

    const logData = {
      nodeId,
      prompt,
      rawResponse,
      timestamp,
    };

    try {
      await this.ddb.send(
        new PutCommand({
          TableName: AI_MESSAGES_TABLE,
          Item: {
            meetingId,
            timestamp,
            message: JSON.stringify(logData),
            ttl,
            type: 'llm_call',
          },
        })
      );
      console.log(JSON.stringify({
        type: 'llm_call.logged',
        meetingId,
        nodeId,
        promptLength: prompt.length,
        responseLength: rawResponse.length,
        timestamp,
      }));
    } catch (err: any) {
      console.error('Failed to store LLM call log', {
        error: err?.message || err,
        meetingId,
        nodeId,
      });
    }
  }
}

const triggerLlm = new TriggerLLM();
const notifier = new Notifier();
const metrics = new Metrics();
const sqs = new SQSClient({});
const notesStore = new NotesStore();
const graspQueue = new GraspQueue();

// すべての Grasp のリスト（YAML設定から動的に構築される）
const grasps: Grasp[] = [];

// Grasp グループを動的に再構築
function rebuildGrasps(graspGroupDef: GraspGroupDefinition): void {
  // 既存 Grasp をクリア
  grasps.length = 0;

  // YAML から新しい Grasp インスタンスを生成
  for (const graspDef of graspGroupDef.grasps) {
    const config: GraspConfig = {
      nodeId: graspDef.nodeId,
      promptTemplate: graspDef.promptTemplate,
      cooldownMs: graspDef.intervalSec * 1000,
      outputHandler: graspDef.outputHandler as 'chat' | 'note' | 'both',
      noteTag: graspDef.noteTag,
    };
    const grasp = new Grasp(config, triggerLlm);
    grasps.push(grasp);
  }

  graspQueue.clear();
  console.log(JSON.stringify({
    type: 'orchestrator.grasps.rebuilt',
    graspCount: grasps.length,
    ts: Date.now()
  }));
}

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

        // Handle meetingId messages (both new and legacy format)
        if (parsed.type === 'meetingId' || (parsed.meetingId && !parsed.type)) {
          CURRENT_MEETING_ID = parsed.meetingId;
          console.log(JSON.stringify({ type: 'orchestrator.control.meeting.set', meetingId: CURRENT_MEETING_ID, ts: Date.now() }));
        }

        // Handle grasp_config update messages
        if (parsed.type === 'grasp_config' && typeof parsed.yaml === 'string') {
          try {
            const graspGroupDef = parseGraspGroupDefinition(parsed.yaml);
            rebuildGrasps(graspGroupDef);
            console.log(JSON.stringify({
              type: 'orchestrator.control.grasp_config.applied',
              graspCount: graspGroupDef.grasps.length,
              ts: Date.now()
            }));
          } catch (error) {
            console.error(JSON.stringify({
              type: 'orchestrator.control.grasp_config.error',
              error: (error as Error).message,
              ts: Date.now()
            }));
          }
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

// グローバル変数（タイマーからアクセスするため）
const window = new WindowBuffer();

async function processMessages(messages: Message[]) {
  for (const message of messages) {
    let ev: AsrEvent | null = null;
    try { ev = JSON.parse(message.Body || ''); } catch {}
    if (!ev) {
      // Delete malformed message
      await sqs.send(
          new DeleteMessageCommand({
            QueueUrl: TRANSCRIPT_QUEUE_URL,
            ReceiptHandle: message.ReceiptHandle!,
          })
      );
      continue;
    }
    if (CURRENT_MEETING_ID && ev.meetingId !== CURRENT_MEETING_ID) {
      // Skip but delete message (not for this orchestrator)
      await sqs.send(
          new DeleteMessageCommand({
            QueueUrl: TRANSCRIPT_QUEUE_URL,
            ReceiptHandle: message.ReceiptHandle!,
          })
      );
      continue;
    }
    if (!ev.isFinal) {
      // Delete non-final message
      await sqs.send(
          new DeleteMessageCommand({
            QueueUrl: TRANSCRIPT_QUEUE_URL,
            ReceiptHandle: message.ReceiptHandle!,
          })
      );
      continue;
    }

    // final文をウィンドウに追加
    // Include speaker information if available
    const speakerPrefix = ev.speakerId ? `[${ev.speakerId}] ` : '';
    window.push(speakerPrefix + ev.text, ev.timestamp);

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

    // 各 Grasp をキューに追加（実行すべきものだけ）
    const now = Date.now();
    for (const grasp of grasps) {
      if (grasp.shouldExecute(now)) {
        graspQueue.enqueue(grasp, ev.timestamp || now);
      }
    }

    // キューから1つだけ実行（グローバルクールダウン付き）
    const notebook = notesStore.getNotebook(ev.meetingId);
    await graspQueue.processNext(window, ev.meetingId, notifier, metrics, notebook);

    // 処理完了後にメッセージを削除
    await sqs.send(
        new DeleteMessageCommand({
          QueueUrl: TRANSCRIPT_QUEUE_URL,
          ReceiptHandle: message.ReceiptHandle!,
        })
    );
  }
}

async function runLoop() {
  console.log(JSON.stringify({
    type: 'orchestrator.loop.config',
    POLL_INTERVAL_MS,
    WINDOW_LINES,
    TRANSCRIPT_QUEUE_URL,
    ts: Date.now()
  }));
  if (!CURRENT_MEETING_ID) console.warn('CURRENT_MEETING_ID is empty. All events will be processed; set via CONTROL_SQS_URL or MEETING_ID env to restrict.');

  let consecutiveErrors = 0;
  let loopCount = 0;
  for (;;) {
    try {
      // control plane (non-blocking)
      await pollControlOnce();
      const t0 = Date.now();
      loopCount++;

      // Use SQS long polling
      const result = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: TRANSCRIPT_QUEUE_URL,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 20,  // Long polling
        })
      );
      const messages = result.Messages || [];

      // Log periodically (heartbeat) or when we receive messages
      if (loopCount % 50 === 0 || messages.length > 0) {
        console.log(JSON.stringify({
          type: 'orchestrator.loop.poll',
          loopCount,
          messageCount: messages.length,
          consecutiveErrors,
          ts: Date.now()
        }));
      }

      await processMessages(messages);
      consecutiveErrors = 0;

      // SQS long polling handles waiting, but add minimal interval for control plane
      const dt = Date.now() - t0;
      const sleepTime = Math.max(0, 100 - dt);  // Minimal sleep since SQS handles long polling
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

// Initialize Grasp configuration from DynamoDB
async function initializeGraspConfig() {
  try {
    // Ensure default config exists, or get existing config
    const yaml = await ensureDefaultGraspConfig(BEDROCK_REGION, CONFIG_TABLE_NAME);

    // Parse and rebuild grasps
    const graspGroupDef = parseGraspGroupDefinition(yaml);
    rebuildGrasps(graspGroupDef);

    console.log(JSON.stringify({
      type: 'orchestrator.config.grasp.initialized',
      graspCount: graspGroupDef.grasps.length,
      ts: Date.now()
    }));
  } catch (e) {
    console.error('Failed to initialize grasp config', (e as any)?.message);
    throw e; // Fail fast if we can't initialize
  }
}

// エントリ
console.log(JSON.stringify({
  type: 'orchestrator.worker.start',
  ts: Date.now(),
  env: { BEDROCK_REGION, BEDROCK_MODEL_ID, CURRENT_MEETING_ID, CONTROL_SQS_URL, CONFIG_TABLE_NAME }
}));

// 定期的にキューを処理（完全な沈黙時でもキューに入った Grasp を実行）
setInterval(async () => {
  if (CURRENT_MEETING_ID && graspQueue.size() > 0) {
    const notebook = notesStore.getNotebook(CURRENT_MEETING_ID);
    const processed = await graspQueue.processNext(window, CURRENT_MEETING_ID, notifier, metrics, notebook);
    if (processed) {
      console.log(JSON.stringify({
        type: 'orchestrator.timer.processed',
        queueSize: graspQueue.size(),
        ts: Date.now()
      }));
    }
  }
}, 3000); // 3秒ごと

(async () => {
  await initializeGraspConfig();
  await runLoop();
})().catch((e) => {
  console.error('worker fatal', e);
  process.exit(1);
});
