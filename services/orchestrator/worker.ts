import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
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
import { buildGraspsFromDefinition } from './graspConfigLoader';
import { Message } from '@aws-sdk/client-sqs';
import { OrchestratorManager } from './orchestratorManager';
import { ChimeAdapter, RecallAdapter, MeetingServiceAdapter, MeetingId, TranscriptEvent } from '@timtam/shared';

// 環境変数
const TRANSCRIPT_QUEUE_URL = process.env.TRANSCRIPT_QUEUE_URL || '';
const BEDROCK_REGION = process.env.BEDROCK_REGION || 'us-east-1';
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-haiku-4.5';
const AI_MESSAGES_TABLE = process.env.AI_MESSAGES_TABLE || 'timtam-ai-messages';
const GRASP_CONFIGS_TABLE = process.env.GRASP_CONFIGS_TABLE || 'timtam-grasp-configs';
const MEETINGS_METADATA_TABLE = process.env.MEETINGS_METADATA_TABLE || 'timtam-meetings-metadata';
const CONTROL_SQS_URL = process.env.CONTROL_SQS_URL || '';
const MAX_MEETINGS = Number(process.env.MAX_MEETINGS || '100');
const MEETING_TIMEOUT_MS = Number(process.env.MEETING_TIMEOUT_MS || '43200000'); // 12時間
const RECALL_API_KEY = process.env.RECALL_API_KEY || '';
if (!RECALL_API_KEY) {
  console.error('RECALL_API_KEY is not set');
}

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

// Platform判別してAdapterを作成する関数
async function createAdapterForMeeting(meetingId: MeetingId): Promise<MeetingServiceAdapter> {
  try {
    const result = await ddbDocClient.send(
      new GetCommand({
        TableName: MEETINGS_METADATA_TABLE,
        Key: { meetingId },
      })
    );

    const platform = result.Item?.platform || 'chime';

    if (platform === 'recall') {
      return new RecallAdapter({
        apiKey: RECALL_API_KEY,
        aiMessagesTable: AI_MESSAGES_TABLE,
      });
    } else {
      return new ChimeAdapter({
        aiMessagesTable: AI_MESSAGES_TABLE,
      });
    }
  } catch (err) {
    console.error('Failed to get platform from DynamoDB, defaulting to Chime', err);
    return new ChimeAdapter({
      aiMessagesTable: AI_MESSAGES_TABLE,
    });
  }
}

const triggerLlm = new TriggerLLM();
const metrics = new Metrics();
const sqs = new SQSClient({});

// DynamoDB Document Client for transcript persistence
const ddbClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

// OrchestratorManager: 複数ミーティングを管理
let orchestratorManager: OrchestratorManager;

// GraspGroupDefinitionからGrasp配列を生成するヘルパー関数

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
              try {
                const configName = parsed.configName || 'カスタム設定';
                const notificationMessage = `Grasp設定「${configName}」を適用しました（${grasps.length}個のGrasp）`;
                await meeting.postChat(parsed.meetingId, notificationMessage);
              } catch (chatError) {
                console.error(JSON.stringify({
                  type: 'orchestrator.control.meeting.grasp_config.chat_success_notification_failed',
                  meetingId: parsed.meetingId,
                  error: chatError instanceof Error ? chatError.message : String(chatError),
                  ts: Date.now()
                }));
              }
            } else {
              console.warn(JSON.stringify({
                type: 'orchestrator.control.meeting.grasp_config.meeting_not_found',
                meetingId: parsed.meetingId,
                ts: Date.now()
              }));
            }
          } catch (error) {
            const errorDetails = error instanceof Error ? error.message : String(error);
            console.error(JSON.stringify({
              type: 'orchestrator.control.meeting.grasp_config.error',
              meetingId: parsed.meetingId,
              error: errorDetails,
              ts: Date.now()
            }));

            // Send error notification to meeting chat
            const meeting = orchestratorManager.getMeeting(parsed.meetingId);
            if (meeting) {
              try {
                const configName = parsed.configName || 'カスタム設定';
                const errorNotificationMessage = `Grasp設定「${configName}」の適用に失敗しました: ${errorDetails}`;
                await meeting.postChat(parsed.meetingId, errorNotificationMessage);
              } catch (chatError) {
                console.error(JSON.stringify({
                  type: 'orchestrator.control.meeting.grasp_config.chat_error_notification_failed',
                  meetingId: parsed.meetingId,
                  error: chatError instanceof Error ? chatError.message : String(chatError),
                  ts: Date.now()
                }));
              }
            }
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
    try {
      const parsed = JSON.parse(message.Body || '');

      // meeting.endedイベントの処理
      if (parsed.type === 'meeting.ended') {
        await handleMeetingEndedMessage(parsed, message);
        return;
      }

      // TranscriptEventの処理
      let ev: TranscriptEvent | null = null;

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
      await orchestratorManager.processTranscriptEvent(ev, metrics);

      // 処理完了後にメッセージを削除
      await sqs.send(
        new DeleteMessageCommand({
          QueueUrl: TRANSCRIPT_QUEUE_URL,
          ReceiptHandle: message.ReceiptHandle!,
        })
      );
    } catch (err) {
      console.error('[Worker] Failed to process message', err);
      // エラー時もメッセージを削除（DLQに送られる）
      await sqs.send(
        new DeleteMessageCommand({
          QueueUrl: TRANSCRIPT_QUEUE_URL,
          ReceiptHandle: message.ReceiptHandle!,
        })
      );
    }
  }));
}

/**
 * meeting.endedイベントの処理
 * DynamoDB更新、内部状態クリーンアップを実行
 */
async function handleMeetingEndedMessage(parsed: any, message: Message): Promise<void> {
  const meetingId = parsed.meetingId as MeetingId;
  const reason = parsed.reason || 'unknown';

  console.log(JSON.stringify({
    type: 'orchestrator.worker.meeting_ended.received',
    meetingId,
    reason,
    ts: Date.now()
  }));

  try {
    // DynamoDBのステータスを更新
    const now = Date.now();
    const ttl = Math.floor(now / 1000) + (7 * 24 * 60 * 60); // 7日後

    await ddbDocClient.send(
      new UpdateCommand({
        TableName: MEETINGS_METADATA_TABLE,
        Key: { meetingId },
        UpdateExpression: 'SET #status = :status, #endedAt = :endedAt, #ttl = :ttl',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#endedAt': 'endedAt',
          '#ttl': 'ttl',
        },
        ExpressionAttributeValues: {
          ':status': 'ended',
          ':endedAt': now,
          ':ttl': ttl,
        },
      })
    );

    console.log(JSON.stringify({
      type: 'orchestrator.worker.meeting_ended.dynamodb_updated',
      meetingId,
      reason,
      ts: Date.now()
    }));
  } catch (err: any) {
    console.error('Failed to update DynamoDB for meeting.ended event', {
      meetingId,
      reason,
      error: err?.message || err,
      stack: err?.stack,
    });
    // DynamoDB更新失敗でもOrchestratorの内部状態はクリーンアップする
  }

  // Orchestratorの内部状態をクリーンアップ
  await orchestratorManager.handleMeetingEnded(meetingId, reason);

  // 処理完了後にメッセージを削除
  await sqs.send(
    new DeleteMessageCommand({
      QueueUrl: TRANSCRIPT_QUEUE_URL,
      ReceiptHandle: message.ReceiptHandle!,
    })
  );
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

// Initialize OrchestratorManager
async function initializeOrchestratorManager() {
  try {
    // Initialize OrchestratorManager
    orchestratorManager = new OrchestratorManager(
      createAdapterForMeeting,
      {
        maxMeetings: MAX_MEETINGS,
        meetingTimeoutMs: MEETING_TIMEOUT_MS,
        region: BEDROCK_REGION,
        graspConfigsTable: GRASP_CONFIGS_TABLE,
        meetingsMetadataTable: MEETINGS_METADATA_TABLE,
        aiMessagesTable: AI_MESSAGES_TABLE,
      }
    );

    // Set LLM client
    orchestratorManager.setLLMClient(triggerLlm);

    console.log(JSON.stringify({
      type: 'orchestrator.manager.initialized',
      ts: Date.now()
    }));
  } catch (e) {
    console.error('Failed to initialize orchestrator manager', (e as any)?.message);
    throw e; // Fail fast if we can't initialize
  }
}

// エントリ
console.log(JSON.stringify({
  type: 'orchestrator.worker.start',
  ts: Date.now(),
  env: { BEDROCK_REGION, BEDROCK_MODEL_ID, MAX_MEETINGS, MEETING_TIMEOUT_MS, CONTROL_SQS_URL, GRASP_CONFIGS_TABLE, MEETINGS_METADATA_TABLE }
}));

// 定期的にすべてのミーティングの待機Graspを処理（完全な沈黙時でも待機中の Grasp を実行）
setInterval(async () => {
  const processed = await orchestratorManager.processAllWaitingGrasps(metrics);
  if (processed > 0) {
    console.log(JSON.stringify({
      type: 'orchestrator.timer.processed',
      processedMeetings: processed,
      ts: Date.now()
    }));
  }
}, 3000); // 3秒ごと

(async () => {
  await initializeOrchestratorManager();
  await runLoop();
})().catch((e) => {
  console.error('worker fatal', e);
  process.exit(1);
});
