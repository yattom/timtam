// OrchestratorManager: 複数ミーティングのオーケストレーターを管理
import { Meeting, MeetingId, AsrEvent } from './meetingOrchestrator';
import { Grasp, LLMClient, Notifier, Metrics } from './grasp';

export interface OrchestratorManagerConfig {
  maxMeetings?: number; // 最大同時ミーティング数
  meetingTimeoutMs?: number; // ミーティングの非アクティブタイムアウト
}

/**
 * OrchestratorManager: 複数ミーティングの管理
 * 
 * 複数のMeetingインスタンスを管理し、
 * ミーティングIDに基づいて適切なオーケストレーターに処理を振り分ける。
 */
export class OrchestratorManager {
  private meetings: Map<MeetingId, Meeting> = new Map();
  private config: Required<OrchestratorManagerConfig>;
  private graspsTemplate: Grasp[];

  constructor(
    graspsTemplate: Grasp[],
    config?: OrchestratorManagerConfig
  ) {
    this.graspsTemplate = graspsTemplate;
    this.config = {
      maxMeetings: config?.maxMeetings || 100,
      meetingTimeoutMs: config?.meetingTimeoutMs || 43200000, // 12時間 (12 * 60 * 60 * 1000)
    };

    console.log(JSON.stringify({
      type: 'orchestrator.manager.created',
      maxMeetings: this.config.maxMeetings,
      meetingTimeoutMs: this.config.meetingTimeoutMs,
      ts: Date.now()
    }));
  }

  /**
   * ミーティング用のオーケストレーターを取得または作成
   */
  getOrCreateMeeting(meetingId: MeetingId): Meeting {
    let meeting = this.meetings.get(meetingId);
    
    if (!meeting) {
      // 最大数チェックとクリーンアップ
      if (this.meetings.size >= this.config.maxMeetings) {
        this.cleanupInactiveMeetings();
      }

      // 新しいオーケストレーターを作成
      meeting = new Meeting(
        { meetingId },
        this.graspsTemplate
      );
      this.meetings.set(meetingId, meeting);

      console.log(JSON.stringify({
        type: 'orchestrator.manager.meeting.created',
        meetingId,
        totalMeetings: this.meetings.size,
        ts: Date.now()
      }));
    }

    return meeting;
  }

  /**
   * 特定のミーティングのオーケストレーターを取得
   */
  getMeeting(meetingId: MeetingId): Meeting | undefined {
    return this.meetings.get(meetingId);
  }

  /**
   * ASRイベントを適切なオーケストレーターに振り分けて処理
   */
  async processAsrEvent(
    ev: AsrEvent,
    notifier: Notifier,
    metrics: Metrics
  ): Promise<void> {
    const meeting = this.getOrCreateMeeting(ev.meetingId);
    await meeting.processAsrEvent(ev, notifier, metrics);
  }

  /**
   * すべてのミーティングの待機Graspを定期的に処理
   * 並列処理により効率化
   */
  async processAllWaitingGrasps(
    notifier: Notifier,
    metrics: Metrics
  ): Promise<number> {
    // Process all meeting waiting Grasps in parallel for better performance
    const results = await Promise.all(
      Array.from(this.meetings.values()).map(async (meeting) => {
        return await meeting.processWaitingGraspsPeriodically(notifier, metrics);
      })
    );

    // Count how many meetings processed something
    return results.filter(processed => processed).length;
  }

  /**
   * 非アクティブなミーティングをクリーンアップ
   */
  cleanupInactiveMeetings(): number {
    const now = Date.now();
    const inactiveMeetings: MeetingId[] = [];

    for (const [meetingId, meeting] of this.meetings) {
      const inactiveTime = now - meeting.getLastActivityTime();
      if (inactiveTime > this.config.meetingTimeoutMs) {
        inactiveMeetings.push(meetingId);
      }
    }

    for (const meetingId of inactiveMeetings) {
      this.removeMeeting(meetingId);
    }

    if (inactiveMeetings.length > 0) {
      console.log(JSON.stringify({
        type: 'orchestrator.manager.cleanup',
        removedMeetings: inactiveMeetings.length,
        remainingMeetings: this.meetings.size,
        ts: Date.now()
      }));
    }

    return inactiveMeetings.length;
  }

  /**
   * 特定のミーティングを削除
   */
  removeMeeting(meetingId: MeetingId): boolean {
    const meeting = this.meetings.get(meetingId);
    if (meeting) {
      meeting.cleanup();
      this.meetings.delete(meetingId);
      console.log(JSON.stringify({
        type: 'orchestrator.manager.meeting.removed',
        meetingId,
        totalMeetings: this.meetings.size,
        ts: Date.now()
      }));
      return true;
    }
    return false;
  }

  /**
   * 特定のミーティングのGraspを再構築（設定変更時）
   */
  rebuildMeetingGrasps(meetingId: MeetingId, grasps: Grasp[]): boolean {
    const meeting = this.meetings.get(meetingId);
    if (meeting) {
      meeting.rebuildGrasps(grasps);
      console.log(JSON.stringify({
        type: 'orchestrator.manager.meeting.grasps.rebuilt',
        meetingId,
        graspCount: grasps.length,
        ts: Date.now()
      }));
      return true;
    }
    return false;
  }

  /**
   * すべての新規ミーティングのためのGraspテンプレートを更新（設定変更時）
   * 既存のミーティングには影響しない
   */
  updateGraspsTemplate(grasps: Grasp[]): void {
    this.graspsTemplate = grasps;

    console.log(JSON.stringify({
      type: 'orchestrator.manager.grasps.template.updated',
      graspCount: grasps.length,
      ts: Date.now()
    }));
  }

  /**
   * 現在のステータスを取得
   */
  getStatus(): {
    totalMeetings: number;
    meetings: Array<{
      meetingId: MeetingId;
      lastActivityTime: number;
      messageCount: number;
    }>;
  } {
    const meetings = Array.from(this.meetings.entries()).map(
      ([meetingId, meeting]) => ({
        meetingId,
        lastActivityTime: meeting.getLastActivityTime(),
        messageCount: meeting.getMessageCount(),
      })
    );

    return {
      totalMeetings: this.meetings.size,
      meetings,
    };
  }

  /**
   * クリーンアップ（シャットダウン時）
   */
  cleanup(): void {
    for (const [meetingId, meeting] of this.meetings) {
      meeting.cleanup();
    }
    this.meetings.clear();
    console.log(JSON.stringify({
      type: 'orchestrator.manager.shutdown',
      ts: Date.now()
    }));
  }
}
