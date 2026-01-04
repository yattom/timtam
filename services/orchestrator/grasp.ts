// Grasp-related types and classes

export type TriggerResult = {
  should_intervene: boolean;
  reason: string;
  message: string;
};

export type JudgeResult = {
  result: TriggerResult | null;
  prompt: string;
  rawResponse: string;
};

export type GraspConfig = {
  nodeId: string;
  promptTemplate: string | ((input: string, notebook?: Notebook) => string);
  inputLength?: number; // undefined = 全部、数値 = 最新N行
  cooldownMs: number;
  outputHandler: 'chat' | 'note' | 'both';
  noteTag?: string;  // 'note' または 'both' の場合、このタグでメモを保存
};

export type Note = {
  tag: string;        // メモの種類（例: 'participant-mood', 'topic-summary'）
  content: string;    // メモの内容
  timestamp: number;  // 作成時刻
  createdBy: string;  // 作成した Grasp の nodeId
};

type BufferLine = {
  text: string;
  timestamp: number;
};

// Interfaces for dependencies (to be implemented by worker.ts)
export interface LLMClient {
  invoke(prompt: string, nodeId: string): Promise<JudgeResult>;
}

export interface Notifier {
  postChat(meetingId: string, message: string): Promise<void>;
  postLlmCallLog(meetingId: string, prompt: string, rawResponse: string, nodeId?: string): Promise<void>;
}

export interface Metrics {
  putLatencyMetric(name: string, ms: number): Promise<void>;
  putCountMetric(name: string, val?: number): Promise<void>;
}

export class Interval {
  private lastExecutionTime: number = 0;

  constructor(private cooldownMs: number) {}

  shouldExecute(now: number): boolean {
    return now - this.lastExecutionTime >= this.cooldownMs;
  }

  markExecuted(now: number): void {
    this.lastExecutionTime = now;
  }
}

export class WindowBuffer {
  private lines: BufferLine[] = [];
  constructor() {}
  push(line: string, timestamp?: number) {
    if (!line) return;
    this.lines.push({ text: line, timestamp: timestamp || Date.now() });
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

export class Notebook {
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

export class NotesStore {
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

export class GraspQueue {
  private queue: Array<{ grasp: Grasp; timestamp: number }> = [];
  private interval: Interval;

  constructor(globalCooldownMs: number = 2000) {
    this.interval = new Interval(globalCooldownMs);
  }

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
    if (!this.interval.shouldExecute(now)) {
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
    this.interval.markExecuted(now);
    return true;
  }

  size(): number {
    return this.queue.length;
  }
}

export class Grasp {
  private config: GraspConfig;
  private interval: Interval;
  private llm: LLMClient;

  constructor(config: GraspConfig, llm: LLMClient) {
    this.config = config;
    this.llm = llm;
    this.interval = new Interval(config.cooldownMs);
  }

  shouldExecute(now: number): boolean {
    return this.interval.shouldExecute(now);
  }

  buildPrompt(
    windowBuffer: WindowBuffer,
    notebook: Notebook,
  ) : string {
    // 入力テキストを取得
    const inputText = this.config.inputLength !== undefined
      ? windowBuffer.content(this.config.inputLength)
      : windowBuffer.content();

    // プロンプトを生成（notebook を渡して、他の Grasp のメモにアクセス可能にする）
    const prompt = typeof this.config.promptTemplate === 'function'
      ? this.config.promptTemplate(inputText, notebook)
      : this.config.promptTemplate + '\n---\n' + inputText;

    return prompt;
  }

  async invokeLLM(prompt: string, meetingId: string, notifier: Notifier) {
    // LLM呼び出し
    const result = await this.llm.invoke(prompt, this.config.nodeId);

    // ログを記録
    await notifier.postLlmCallLog(meetingId, result.prompt, result.rawResponse, this.config.nodeId);

    return result;
  }

  async reflectResponse(
      response: JudgeResult,
      meetingId: string,
      notifier: Notifier,
      notebook: Notebook
  ) {
    if (!response.result || !response.result.should_intervene) {
      return;
    }

    // チャットへの投稿
    if (this.config.outputHandler === 'chat' || this.config.outputHandler === 'both') {
      await notifier.postChat(meetingId, response.result.message);
    }

    // ノートへの記録
    if (this.config.outputHandler === 'note' || this.config.outputHandler === 'both') {
      const tag = this.config.noteTag || this.config.nodeId;  // デフォルトは nodeId
      notebook.addNote(tag, response.result.message, this.config.nodeId);
    }
  }

  async recordMetrics(
    metrics: Metrics,
    startTime: number,
    asrTimestamp?: number
  ): Promise<void> {
    const now = Date.now();

    // Grasp 実行レイテンシを記録（全 Grasp 共通）
    await metrics.putLatencyMetric(`Grasp.${this.config.nodeId}.ExecutionLatency`, now - startTime);

    // ASR → 判定の E2E レイテンシを記録（ASR タイムスタンプがある場合）
    if (asrTimestamp) {
      await metrics.putLatencyMetric(`Grasp.${this.config.nodeId}.E2ELatency`, now - asrTimestamp);
    }
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
      const prompt = this.buildPrompt(windowBuffer, notebook);
      const response = await this.invokeLLM(prompt, meetingId, notifier);
      await this.reflectResponse(response, meetingId, notifier, notebook);
      await this.recordMetrics(metrics, startTime, asrTimestamp);

      this.interval.markExecuted(Date.now());
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
      this.interval.markExecuted(now); // エラーでも時刻を更新してリトライループを防ぐ
    }
  }
}
