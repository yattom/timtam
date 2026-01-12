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

export type AsrEvent = {
  meetingId: MeetingId;
  speakerId?: string;
  text: string;
  isFinal: boolean;
  timestamp?: number; // epoch ms
  sequenceNumber?: string;
};

export interface MeetingConfig {
  meetingId: MeetingId;
  windowLines?: number;
}

/**
 * Meeting: 単一ミーティング用のオーケストレーター
 * 
 * 各ミーティングは独立した状態（WindowBuffer、Notebook、waiting Grasps）を持ち、
 * 他のミーティングと干渉しない。
 */
export class Meeting {
  private meetingId: MeetingId;
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
    this.window = new WindowBuffer();
    this.notebook = new Notebook(config.meetingId);
    this.graspQueue = new GraspQueue();
    this.grasps = grasps;
    this.lastActivityTime = Date.now();

    console.log(JSON.stringify({
      type: 'meeting.created',
      meetingId: this.meetingId,
      graspCount: this.grasps.length,
      ts: Date.now()
    }));
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
   * ASRイベントを処理し、waiting Graspsに追加
   */
  async processAsrEvent(
    ev: AsrEvent,
    notifier: Notifier,
    metrics: Metrics
  ): Promise<void> {
    this.lastActivityTime = Date.now();
    this.messageCount++;

    // final文をウィンドウに追加
    const speakerPrefix = ev.speakerId ? `[${ev.speakerId}] ` : '';
    this.window.push(speakerPrefix + ev.text, ev.timestamp);

    // Log speaker information for debugging
    if (ev.speakerId) {
      console.log(JSON.stringify({
        type: 'meeting.transcript.speaker',
        meetingId: ev.meetingId,
        speakerId: ev.speakerId,
        textLength: ev.text.length,
        ts: Date.now()
      }));
    }

    // 各 Grasp を待機リストに追加（実行すべきものだけ）
    const now = Date.now();
    for (const grasp of this.grasps) {
      if (grasp.shouldExecute(now)) {
        this.graspQueue.enqueue(grasp, ev.timestamp || now);
      }
    }

    // 待機中のGraspから1つだけ実行（グローバルクールダウン付き）
    await this.graspQueue.processNext(
      this.window,
      ev.meetingId,
      notifier,
      metrics,
      this.notebook
    );
  }

  /**
   * 定期的な待機Grasp処理（沈黙時でも待機中のGraspを実行）
   */
  async processWaitingGraspsPeriodically(
    notifier: Notifier,
    metrics: Metrics
  ): Promise<boolean> {
    if (this.graspQueue.size() === 0) {
      return false;
    }

    const processed = await this.graspQueue.processNext(
      this.window,
      this.meetingId,
      notifier,
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
