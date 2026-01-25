// Meeting: 各ミーティング専用のオーケストレーターインスタンス
import {
  MeetingId,
  WindowBuffer,
  Notebook,
  NotesStore,
  GraspQueue,
  Grasp,
  LLMClient,
  Notifier,
  Metrics,
} from './grasp';
import { Message } from '@aws-sdk/client-sqs';
import { TranscriptEvent, MeetingServiceAdapter } from '@timtam/shared';

export interface MeetingConfig {
  meetingId: MeetingId;
  adapter: MeetingServiceAdapter;
  windowLines?: number;
}

/**
 * Meeting: 単一ミーティング用のオーケストレーター
 *
 * 各ミーティングは独立した状態（WindowBuffer、Notebook、waiting Grasps）を持ち、
 * 他のミーティングと干渉しない。
 * Notifierインターフェースを実装し、内部のadapterに委譲する。
 */
export class Meeting implements Notifier {
  private meetingId: MeetingId;
  private adapter: MeetingServiceAdapter;
  private window: WindowBuffer;
  private notebook: Notebook;
  private graspQueue: GraspQueue;
  private grasps: Grasp[];
  private lastActivityTime: number;
  private messageCount: number = 0;

  constructor(
    config: MeetingConfig,
    grasps: Grasp[]
  ) {
    this.meetingId = config.meetingId;
    this.adapter = config.adapter;
    this.window = new WindowBuffer();
    this.notebook = new Notebook(config.meetingId);
    this.graspQueue = new GraspQueue();
    this.grasps = grasps;
    this.lastActivityTime = Date.now();

    console.log(JSON.stringify({
      type: 'meeting.created',
      meetingId: this.meetingId,
      adapter: this.adapter.constructor.name,
      graspCount: this.grasps.length,
      ts: Date.now()
    }));
  }

  // Notifierインターフェース実装
  async postChat(meetingId: MeetingId, message: string): Promise<void> {
    return this.adapter.postChat(meetingId, message);
  }

  async postLlmCallLog(meetingId: MeetingId, prompt: string, rawResponse: string, nodeId?: string): Promise<void> {
    return this.adapter.postLlmCallLog(meetingId, prompt, rawResponse, nodeId);
  }

  getMeetingId(): MeetingId {
    return this.meetingId;
  }

  getLastActivityTime(): number {
    return this.lastActivityTime;
  }

  getMessageCount(): number {
    return this.messageCount;
  }

  /**
   * Transcriptイベントを処理し、waiting Graspsに追加
   */
  async processTranscriptEvent(
    ev: TranscriptEvent,
    metrics: Metrics
  ): Promise<void> {
    this.lastActivityTime = Date.now();
    this.messageCount++;

    // final文をウィンドウに追加
    const speakerPrefix = `[${ev.speakerId}] `;
    this.window.push(speakerPrefix + ev.text, ev.timestamp);

    // Log speaker information for debugging
    console.log(JSON.stringify({
      type: 'meeting.transcript.speaker',
      meetingId: ev.meetingId,
      speakerId: ev.speakerId,
      textLength: ev.text.length,
      ts: Date.now()
    }));

    // 各 Grasp を待機リストに追加（実行すべきものだけ）
    const now = Date.now();
    for (const grasp of this.grasps) {
      if (grasp.shouldExecute(now)) {
        this.graspQueue.enqueue(grasp, ev.timestamp);
      }
    }

    // 待機中のGraspから1つだけ実行（グローバルクールダウン付き）
    await this.graspQueue.processNext(
      this.window,
      ev.meetingId,
      this,
      metrics,
      this.notebook
    );
  }

  /**
   * 定期的な待機Grasp処理（沈黙時でも待機中のGraspを実行）
   */
  async processWaitingGraspsPeriodically(
    metrics: Metrics
  ): Promise<boolean> {
    if (this.graspQueue.size() === 0) {
      return false;
    }

    const processed = await this.graspQueue.processNext(
      this.window,
      this.meetingId,
      this,
      metrics,
      this.notebook
    );

    if (processed) {
      console.log(JSON.stringify({
        type: 'meeting.timer.processed',
        meetingId: this.meetingId,
        waitingGrasps: this.graspQueue.size(),
        ts: Date.now()
      }));
    }

    return processed;
  }

  /**
   * Graspの再構築（設定変更時）
   */
  rebuildGrasps(grasps: Grasp[]): void {
    this.grasps = grasps;
    this.graspQueue.clear();
    console.log(JSON.stringify({
      type: 'meeting.grasps.rebuilt',
      meetingId: this.meetingId,
      graspCount: this.grasps.length,
      ts: Date.now()
    }));
  }

  /**
   * クリーンアップ（ミーティング終了時）
   */
  cleanup(): void {
    this.graspQueue.clear();
    console.log(JSON.stringify({
      type: 'meeting.cleanup',
      meetingId: this.meetingId,
      messageCount: this.messageCount,
      ts: Date.now()
    }));
  }
}
