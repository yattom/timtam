import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import {
  Grasp,
  GraspConfig,
  TriggerResult,
  JudgeResult,
  LLMClient,
  Notifier as INotifier,
  Metrics as IMetrics
} from './grasp';
import { parseGraspGroupDefinition, GraspGroupDefinition } from './graspConfigParser';
import { ensureDefaultGraspConfig } from './selfSetup';
import { Message } from '@aws-sdk/client-sqs';
import { OrchestratorManager } from './orchestratorManager';
import { ChimeAdapter, MeetingId, TranscriptEvent } from '@timtam/shared';

// 環境変数
const TRANSCRIPT_QUEUE_URL = process.env.TRANSCRIPT_QUEUE_URL || '';
const BEDROCK_REGION = process.env.BEDROCK_REGION || 'us-east-1';
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-haiku-4.5';
const AI_MESSAGES_TABLE = process.env.AI_MESSAGES_TABLE || 'timtam-ai-messages';
const CONFIG_TABLE_NAME = process.env.CONFIG_TABLE_NAME || 'timtam-orchestrator-config';
const CONTROL_SQS_URL = process.env.CONTROL_SQS_URL || '';
const MAX_MEETINGS = Number(process.env.MAX_MEETINGS || '100');
const MEETING_TIMEOUT_MS = Number(process.env.MEETING_TIMEOUT_MS || '43200000'); // 12時間

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
      if (parsed && parsed.should_output !== undefined) {
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

// Notifierは@timtam/sharedのChimeAdapterに置き換え
// ただし、INotifierインターフェースとの互換性を保つため、ラッパークラスを定義
class Notifier implements INotifier {
  private adapter: ChimeAdapter;

  constructor() {
    this.adapter = new ChimeAdapter({
      aiMessagesTable: AI_MESSAGES_TABLE,
    });
  }

  async postChat(meetingId: MeetingId, message: string) {
    return this.adapter.postChat(meetingId, message);
  }

  async postLlmCallLog(meetingId: MeetingId, prompt: string, rawResponse: string, nodeId: string = 'default') {
    return this.adapter.postLlmCallLog(meetingId, prompt, rawResponse, nodeId);
  }
}

const triggerLlm = new TriggerLLM();
const notifier = new Notifier();
const metrics = new Metrics();
const sqs = new SQSClient({});

// DynamoDB Document Client for transcript persistence
const ddbClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

// OrchestratorManager: 複数ミーティングを管理
let orchestratorManager: OrchestratorManager;

// Grasp テンプレートのリスト（YAML設定から動的に構築される）
const graspTemplates: Grasp[] = [];

// GraspGroupDefinitionからGrasp配列を生成するヘルパー関数
export function buildGraspsFromDefinition(graspGroupDef: GraspGroupDefinition, llmClient: LLMClient): Grasp[] {
  const grasps: Grasp[] = [];
  
  for (const graspDef of graspGroupDef.grasps) {
    const config: GraspConfig = {
      nodeId: graspDef.nodeId,
      promptTemplate: graspDef.promptTemplate,
      cooldownMs: graspDef.intervalSec * 1000,
      outputHandler: graspDef.outputHandler as 'chat' | 'note' | 'both',
      noteTag: graspDef.noteTag,
    };
    const grasp = new Grasp(config, llmClient);
    grasps.push(grasp);
  }
  
  return grasps;
}

// Grasp グループを動的に再構築
function rebuildGrasps(graspGroupDef: GraspGroupDefinition): void {
  // 既存 Grasp テンプレートをクリア
  graspTemplates.length = 0;

  // YAML から新しい Grasp インスタンスを生成
  const grasps = buildGraspsFromDefinition(graspGroupDef, triggerLlm);
  graspTemplates.push(...grasps);

  // すべての新規ミーティングのためのGraspテンプレートを更新
  // 既存のミーティングには影響しない
  if (orchestratorManager) {
    orchestratorManager.updateGraspsTemplate(graspTemplates);
  }

  console.log(JSON.stringify({
    type: 'orchestrator.grasps.template.rebuilt',
    graspCount: graspTemplates.length,
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

        // Handle grasp_config update messages (global update)
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

        // Handle apply_grasp_config messages (meeting-specific update)
        if (parsed.type === 'apply_grasp_config' && typeof parsed.meetingId === 'string' && typeof parsed.yaml === 'string') {
          try {
            const graspGroupDef = parseGraspGroupDefinition(parsed.yaml);
            const grasps = buildGraspsFromDefinition(graspGroupDef, triggerLlm);

            // Apply config to specific meeting
            const meeting = orchestratorManager.getMeeting(parsed.meetingId);
            if (meeting) {
              orchestratorManager.rebuildMeetingGrasps(parsed.meetingId, grasps);
              console.log(JSON.stringify({
                type: 'orchestrator.control.meeting.grasp_config.applied',
                meetingId: parsed.meetingId,
                graspCount: grasps.length,
                ts: Date.now()
              }));

              // Send chat notification to meeting
              const configName = parsed.configName || 'カスタム設定';
              const notificationMessage = `Grasp設定「${configName}」を適用しました（${grasps.length}個のGrasp）`;
              await notifier.postChat(parsed.meetingId, notificationMessage);
            } else {
              console.warn(JSON.stringify({
                type: 'orchestrator.control.meeting.grasp_config.meeting_not_found',
                meetingId: parsed.meetingId,
                ts: Date.now()
              }));
            }
          } catch (error) {
            console.error(JSON.stringify({
              type: 'orchestrator.control.meeting.grasp_config.error',
              meetingId: parsed.meetingId,
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

// Final transcriptをDynamoDBに保存
async function saveTranscriptToDynamoDB(event: TranscriptEvent): Promise<void> {
  const timestamp = event.timestamp;
  const ttl = Math.floor(Date.now() / 1000) + 86400; // 24時間後に削除

  try {
    await ddbDocClient.send(
      new PutCommand({
        TableName: AI_MESSAGES_TABLE,
        Item: {
          meetingId: event.meetingId,
          timestamp: timestamp,
          message: JSON.stringify({
            speakerId: event.speakerId,
            text: event.text,
            isFinal: event.isFinal,
          }),
          ttl: ttl,
          type: 'transcript', // 新しいtype
        },
      })
    );
  } catch (err) {
    console.error('[Worker] Failed to save transcript to DynamoDB', err);
  }
}

async function processMessages(messages: Message[]) {
  // Process messages in parallel for better throughput
  await Promise.all(messages.map(async (message) => {
    let ev: TranscriptEvent | null = null;
    try { 
      const parsed = JSON.parse(message.Body || '');
      
      // Validate required fields for TranscriptEvent
      if (!parsed.meetingId || !parsed.speakerId || typeof parsed.text !== 'string' || 
          typeof parsed.isFinal !== 'boolean' || typeof parsed.timestamp !== 'number') {
        console.warn('[Worker] Invalid TranscriptEvent format', { 
          hasmeeting: !!parsed.meetingId,
          hasSpeaker: !!parsed.speakerId,
          hasText: typeof parsed.text === 'string',
          hasisFinal: typeof parsed.isFinal === 'boolean',
          hasTimestamp: typeof parsed.timestamp === 'number'
        });
        ev = null;
      } else {
        // Cast to TranscriptEvent with MeetingId type
        ev = {
          ...parsed,
          meetingId: parsed.meetingId as MeetingId
        } as TranscriptEvent;
      }
    } catch (err) {
      console.error('[Worker] Failed to parse message', err);
    }
    
    if (!ev) {
      // Delete malformed message
      await sqs.send(
          new DeleteMessageCommand({
            QueueUrl: TRANSCRIPT_QUEUE_URL,
            ReceiptHandle: message.ReceiptHandle!,
          })
      );
      return;
    }

    if (!ev.isFinal) {
      // Delete non-final message
      await sqs.send(
          new DeleteMessageCommand({
            QueueUrl: TRANSCRIPT_QUEUE_URL,
            ReceiptHandle: message.ReceiptHandle!,
          })
      );
      return;
    }

    // Final transcriptをDynamoDBに保存（Grasp実行前）
    await saveTranscriptToDynamoDB(ev);

    // ミーティングIDに基づいて適切なオーケストレーターに処理を委譲
    await orchestratorManager.processTranscriptEvent(ev, notifier, metrics);

    // 処理完了後にメッセージを削除
    await sqs.send(
        new DeleteMessageCommand({
          QueueUrl: TRANSCRIPT_QUEUE_URL,
          ReceiptHandle: message.ReceiptHandle!,
        })
    );
  }));
}

async function runLoop() {
  console.log(JSON.stringify({
    type: 'orchestrator.loop.config',
    TRANSCRIPT_QUEUE_URL,
    MAX_MEETINGS,
    MEETING_TIMEOUT_MS,
    ts: Date.now()
  }));

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
        const status = orchestratorManager.getStatus();
        console.log(JSON.stringify({
          type: 'orchestrator.loop.poll',
          loopCount,
          messageCount: messages.length,
          consecutiveErrors,
          activeMeetings: status.totalMeetings,
          ts: Date.now()
        }));
      }

      await processMessages(messages);
      consecutiveErrors = 0;

      // 非アクティブなミーティングのクリーンアップ（100ループごと）
      if (loopCount % 100 === 0) {
        orchestratorManager.cleanupInactiveMeetings();
      }

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

    // Initialize OrchestratorManager with grasp templates
    orchestratorManager = new OrchestratorManager(graspTemplates, {
      maxMeetings: MAX_MEETINGS,
      meetingTimeoutMs: MEETING_TIMEOUT_MS,
    });

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
  env: { BEDROCK_REGION, BEDROCK_MODEL_ID, MAX_MEETINGS, MEETING_TIMEOUT_MS, CONTROL_SQS_URL, CONFIG_TABLE_NAME }
}));

// 定期的にすべてのミーティングの待機Graspを処理（完全な沈黙時でも待機中の Grasp を実行）
setInterval(async () => {
  const processed = await orchestratorManager.processAllWaitingGrasps(notifier, metrics);
  if (processed > 0) {
    console.log(JSON.stringify({
      type: 'orchestrator.timer.processed',
      processedMeetings: processed,
      ts: Date.now()
    }));
  }
}, 3000); // 3秒ごと

(async () => {
  await initializeGraspConfig();
  await runLoop();
})().catch((e) => {
  console.error('worker fatal', e);
  process.exit(1);
});
