import { KinesisClient, GetShardIteratorCommand, GetRecordsCommand, DescribeStreamCommand } from '@aws-sdk/client-kinesis';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

// 環境変数
const STREAM_NAME = process.env.KINESIS_STREAM_NAME || 'timtam-asr';
const TRANSCRIPT_QUEUE_URL = process.env.TRANSCRIPT_QUEUE_URL || '';  // ADR-0011: SQS FIFO queue
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

type JudgeResult = {
  result: TriggerResult | null;
  prompt: string;
  rawResponse: string;
};

type GraspConfig = {
  nodeId: string;
  promptTemplate: string | ((input: string, notebook?: Notebook) => string);
  inputLength?: number; // undefined = 全部、数値 = 最新N行
  cooldownMs: number;
  outputHandler: 'chat' | 'note' | 'both';
  noteTag?: string;  // 'note' または 'both' の場合、このタグでメモを保存
};

type Note = {
  tag: string;        // メモの種類（例: 'participant-mood', 'topic-summary'）
  content: string;    // メモの内容
  timestamp: number;  // 作成時刻
  createdBy: string;  // 作成した Grasp の nodeId
};

type BufferLine = {
  text: string;
  timestamp: number;
};

class WindowBuffer {
  private lines: BufferLine[] = [];
  constructor(private maxLines: number) {}
  push(line: string, timestamp?: number) {
    if (!line) return;
    this.lines.push({ text: line, timestamp: timestamp || Date.now() });
    while (this.lines.length > this.maxLines) this.lines.shift();
  }
  content(lastN?: number): string {
    const linesToUse = lastN !== undefined
      ? this.lines.slice(-lastN)
      : this.lines;
    return linesToUse.map(l => {
      const time = new Date(l.timestamp).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo' });
      return `[${time}] ${l.text}`;
    }).join('\n');
  }
}

class Notebook {
  private meetingId: string;
  private notes: Note[] = [];

  constructor(meetingId: string) {
    this.meetingId = meetingId;
  }

  addNote(tag: string, content: string, createdBy: string): void {
    this.notes.push({
      tag,
      content,
      timestamp: Date.now(),
      createdBy
    });
    console.log(JSON.stringify({
      type: 'notebook.note.added',
      meetingId: this.meetingId,
      tag,
      createdBy,
      contentLength: content.length,
      totalNotes: this.notes.length,
      ts: Date.now()
    }));
  }

  getNotesByTag(tag: string): Note[] {
    return this.notes.filter(note => note.tag === tag);
  }

  getLatestNoteByTag(tag: string): Note | null {
    const notes = this.getNotesByTag(tag);
    return notes.length > 0 ? notes[notes.length - 1] : null;
  }

  getAllNotes(): Note[] {
    return [...this.notes];
  }

  getMeetingId(): string {
    return this.meetingId;
  }
}

class NotesStore {
  private notebooks: Map<string, Notebook> = new Map();

  getNotebook(meetingId: string): Notebook {
    if (!this.notebooks.has(meetingId)) {
      this.notebooks.set(meetingId, new Notebook(meetingId));
      console.log(JSON.stringify({
        type: 'notebook.created',
        meetingId,
        ts: Date.now()
      }));
    }
    return this.notebooks.get(meetingId)!;
  }

  clearNotebook(meetingId: string): void {
    this.notebooks.delete(meetingId);
    console.log(JSON.stringify({
      type: 'notebook.cleared',
      meetingId,
      ts: Date.now()
    }));
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

class GraspQueue {
  private queue: Array<{ grasp: Grasp; timestamp: number }> = [];
  private lastExecutionTime: number = 0;
  private globalCooldownMs: number = 2000; // グローバルクールダウン: 2秒

  enqueue(grasp: Grasp, timestamp: number): void {
    // すでにキューに入っていなければ追加
    if (!this.queue.find(item => item.grasp === grasp)) {
      this.queue.push({ grasp, timestamp });
      console.log(JSON.stringify({
        type: 'grasp.queue.enqueued',
        nodeId: grasp['config'].nodeId,
        queueSize: this.queue.length,
        ts: Date.now()
      }));
    }
  }

  async processNext(
    window: WindowBuffer,
    meetingId: string,
    notifier: Notifier,
    metrics: Metrics,
    notebook: Notebook
  ): Promise<boolean> {
    const now = Date.now();

    // グローバルクールダウンチェック
    if (now - this.lastExecutionTime < this.globalCooldownMs) {
      return false;
    }

    // キューから次の Grasp を取得
    if (this.queue.length === 0) {
      return false;
    }

    const { grasp, timestamp } = this.queue.shift()!;

    // 古すぎる場合はスキップ（1分以上経過）
    if (now - timestamp > 60000) {
      console.log(JSON.stringify({
        type: 'grasp.queue.skipped',
        nodeId: grasp['config'].nodeId,
        reason: 'too_old',
        age: now - timestamp,
        ts: now
      }));
      return false;
    }

    console.log(JSON.stringify({
      type: 'grasp.queue.processing',
      nodeId: grasp['config'].nodeId,
      queueSize: this.queue.length,
      age: now - timestamp,
      ts: now
    }));

    await grasp.execute(window, meetingId, notifier, metrics, notebook, timestamp);
    this.lastExecutionTime = now;
    return true;
  }

  size(): number {
    return this.queue.length;
  }
}

class Grasp {
  private config: GraspConfig;
  private lastExecutionTime: number = 0;
  private llm: TriggerLLM;

  constructor(config: GraspConfig, llm: TriggerLLM) {
    this.config = config;
    this.llm = llm;
  }

  shouldExecute(now: number): boolean {
    return now - this.lastExecutionTime >= this.config.cooldownMs;
  }

  async execute(
    windowBuffer: WindowBuffer,
    meetingId: string,
    notifier: Notifier,
    metrics: Metrics,
    notebook: Notebook,
    asrTimestamp?: number  // ASR イベントのタイムスタンプ（E2E レイテンシ測定用）
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // 入力テキストを取得
      const inputText = this.config.inputLength !== undefined
        ? windowBuffer.content(this.config.inputLength)
        : windowBuffer.content();

      // プロンプトを生成（notebook を渡して、他の Grasp のメモにアクセス可能にする）
      const prompt = typeof this.config.promptTemplate === 'function'
        ? this.config.promptTemplate(inputText, notebook)
        : this.config.promptTemplate + '\n---\n' + inputText;

      // LLM呼び出し
      const result = await this.llm.invoke(prompt, this.config.nodeId);

      // ログを記録
      await notifier.postLlmCallLog(meetingId, result.prompt, result.rawResponse, this.config.nodeId);

      // 出力処理
      if (result.result && result.result.should_intervene) {
        // チャットへの投稿
        if (this.config.outputHandler === 'chat' || this.config.outputHandler === 'both') {
          await notifier.postChat(meetingId, result.result.message);
        }

        // ノートへの記録
        if (this.config.outputHandler === 'note' || this.config.outputHandler === 'both') {
          const tag = this.config.noteTag || this.config.nodeId;  // デフォルトは nodeId
          notebook.addNote(tag, result.result.message, this.config.nodeId);
        }
      }

      const now = Date.now();

      // Grasp 実行レイテンシを記録（全 Grasp 共通）
      await metrics.putLatencyMetric(`Grasp.${this.config.nodeId}.ExecutionLatency`, now - startTime);

      // ASR → 判定の E2E レイテンシを記録（ASR タイムスタンプがある場合）
      if (asrTimestamp) {
        await metrics.putLatencyMetric(`Grasp.${this.config.nodeId}.E2ELatency`, now - asrTimestamp);
      }

      this.lastExecutionTime = now;
    } catch (e) {
      const now = Date.now();
      console.error(JSON.stringify({
        type: 'orchestrator.grasp.error',
        nodeId: this.config.nodeId,
        error: (e as any)?.message || String(e),
        errorName: (e as any)?.name,
        ts: now
      }));
      await metrics.putCountMetric(`Grasp.${this.config.nodeId}.Errors`, 1);
      this.lastExecutionTime = now; // エラーでも時刻を更新してリトライループを防ぐ
    }
  }
}

const kinesis = new KinesisClient({});
const triggerLlm = new TriggerLLM();
const notifier = new Notifier();
const metrics = new Metrics();
const sqs = new SQSClient({});
const notesStore = new NotesStore();
const graspQueue = new GraspQueue();

// Grasp インスタンス（各LLM呼び出しの設定）
const judgeGrasp = new Grasp(
  {
    nodeId: 'judge',
    promptTemplate: (input: string) =>
      `以下は会議の直近確定発話です。\n` +
      CURRENT_PROMPT + `\n` +
      `\n` +
      '介入が必要かを判断し、次のJSON形式だけを厳密に返してください:\n' +
      '{"should_intervene": boolean, "reason": string, "message": string}\n' +
      '---\n' + input,
    inputLength: WINDOW_LINES,
    cooldownMs: 20000,
    outputHandler: 'chat',
  },
  triggerLlm
);

const toneObserverGrasp = new Grasp(
  {
    nodeId: 'tone-observer',
    promptTemplate: (input: string) =>
      `以下は会議の確定発話です。\n` +
      `ここまでの会議の流れを整理してください。\n` +
      `\n` +
      'コメントが必要かを判断し、次のJSON形式だけを厳密に返してください:\n' +
      '{"should_intervene": boolean, "reason": string, "message": string}\n' +
      '---\n' + input,
    cooldownMs: 60000, // 1分に1回
    outputHandler: 'chat',
  },
  triggerLlm
);

// テスト用: 参加者の雰囲気を観察してノートに記録
const moodGrasp = new Grasp(
  {
    nodeId: 'mood-observer',
    promptTemplate: (input: string) =>
      `以下は会議の直近確定発話です。\n` +
      `参加者の雰囲気や感情を観察してください。\n` +
      `例えば: 活発、落ち着いている、緊張している、議論が白熱している、など。\n` +
      `\n` +
      '観察結果を次のJSON形式だけを厳密に返してください:\n' +
      '{"should_intervene": true, "reason": "観察理由", "message": "雰囲気の簡潔な説明"}\n' +
      '---\n' + input,
    inputLength: WINDOW_LINES,
    cooldownMs: 30000, // 30秒に1回
    outputHandler: 'note',
    noteTag: 'participant-mood',
  },
  triggerLlm
);

// テスト用: 雰囲気メモを読み込んで、それに基づいて介入
const moodBasedInterventionGrasp = new Grasp(
  {
    nodeId: 'mood-based-intervention',
    promptTemplate: (input: string, notebook?: Notebook) => {
      let moodContext = '';
      if (notebook) {
        const moodNotes = notebook.getNotesByTag('participant-mood');
        if (moodNotes.length > 0) {
          // 最新3件のメモを取得
          const recentMoods = moodNotes.slice(-3).map(note =>
            `[${new Date(note.timestamp).toLocaleTimeString()}] ${note.content}`
          ).join('\n');
          moodContext = `\n\n【これまでの雰囲気観察】\n${recentMoods}\n`;
        }
      }

      return (
        `以下は会議の直近確定発話です。\n` +
        `これまでの雰囲気観察を踏まえて、必要に応じて会議の進行をサポートしてください。\n` +
        moodContext +
        `\n` +
        '介入が必要かを判断し、次のJSON形式だけを厳密に返してください:\n' +
        '{"should_intervene": boolean, "reason": string, "message": string}\n' +
        '---\n' + input
      );
    },
    inputLength: WINDOW_LINES,
    cooldownMs: 45000, // 45秒に1回
    outputHandler: 'chat',
  },
  triggerLlm
);

// すべての Grasp のリスト（新しい Grasp はここに追加するだけ）
const grasps = [judgeGrasp, toneObserverGrasp, moodGrasp, moodBasedInterventionGrasp];

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

// グローバル変数（タイマーからアクセスするため）
const window = new WindowBuffer(WINDOW_LINES);

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

      // ADR-0011: Use SQS long polling instead of Kinesis
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
        consecutiveErrors = 0;
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
  await initializePrompt();
  await runLoop();
})().catch((e) => {
  console.error('worker fatal', e);
  process.exit(1);
});
