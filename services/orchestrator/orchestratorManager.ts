// OrchestratorManager: 複数ミーティングのオーケストレーターを管理
import { MeetingOrchestrator, AsrEvent } from './meetingOrchestrator';
import { Grasp, LLMClient, Notifier, Metrics } from './grasp';

export interface OrchestratorManagerConfig {
  maxMeetings?: number; // 最大同時ミーティング数
  meetingTimeoutMs?: number; // ミーティングの非アクティブタイムアウト
}

/**
 * OrchestratorManager: 複数ミーティングの管理
 * 
 * 複数のMeetingOrchestratorインスタンスを管理し、
 * ミーティングIDに基づいて適切なオーケストレーターに処理を振り分ける。
 */
export class OrchestratorManager {
  private orchestrators: Map<string, MeetingOrchestrator> = new Map();
  private config: Required<OrchestratorManagerConfig>;
  private graspsTemplate: Grasp[];

  constructor(
    graspsTemplate: Grasp[],
    config?: OrchestratorManagerConfig
  ) {
    this.graspsTemplate = graspsTemplate;
    this.config = {
      maxMeetings: config?.maxMeetings || 100,
      meetingTimeoutMs: config?.meetingTimeoutMs || 3600000, // 1時間
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
  getOrCreateOrchestrator(meetingId: string): MeetingOrchestrator {
    let orchestrator = this.orchestrators.get(meetingId);
    
    if (!orchestrator) {
      // 最大数チェックとクリーンアップ
      if (this.orchestrators.size >= this.config.maxMeetings) {
        this.cleanupInactiveMeetings();
      }

      // 新しいオーケストレーターを作成
      orchestrator = new MeetingOrchestrator(
        { meetingId },
        this.graspsTemplate
      );
      this.orchestrators.set(meetingId, orchestrator);

      console.log(JSON.stringify({
        type: 'orchestrator.manager.meeting.created',
        meetingId,
        totalMeetings: this.orchestrators.size,
        ts: Date.now()
      }));
    }

    return orchestrator;
  }

  /**
   * 特定のミーティングのオーケストレーターを取得
   */
  getOrchestrator(meetingId: string): MeetingOrchestrator | undefined {
    return this.orchestrators.get(meetingId);
  }

  /**
   * ASRイベントを適切なオーケストレーターに振り分けて処理
   */
  async processAsrEvent(
    ev: AsrEvent,
    notifier: Notifier,
    metrics: Metrics
  ): Promise<void> {
    const orchestrator = this.getOrCreateOrchestrator(ev.meetingId);
    await orchestrator.processAsrEvent(ev, notifier, metrics);
  }

  /**
   * すべてのミーティングのキューを定期的に処理
   * 並列処理により効率化
   */
  async processAllQueues(
    notifier: Notifier,
    metrics: Metrics
  ): Promise<number> {
    // Process all meeting queues in parallel for better performance
    const results = await Promise.all(
      Array.from(this.orchestrators.values()).map(async (orchestrator) => {
        return await orchestrator.processQueuePeriodically(notifier, metrics);
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
    const inactiveMeetings: string[] = [];

    for (const [meetingId, orchestrator] of this.orchestrators) {
      const inactiveTime = now - orchestrator.getLastActivityTime();
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
        remainingMeetings: this.orchestrators.size,
        ts: Date.now()
      }));
    }

    return inactiveMeetings.length;
  }

  /**
   * 特定のミーティングを削除
   */
  removeMeeting(meetingId: string): boolean {
    const orchestrator = this.orchestrators.get(meetingId);
    if (orchestrator) {
      orchestrator.cleanup();
      this.orchestrators.delete(meetingId);
      console.log(JSON.stringify({
        type: 'orchestrator.manager.meeting.removed',
        meetingId,
        totalMeetings: this.orchestrators.size,
        ts: Date.now()
      }));
      return true;
    }
    return false;
  }

  /**
   * すべてのミーティングのGraspを再構築（設定変更時）
   */
  rebuildAllGrasps(grasps: Grasp[]): void {
    this.graspsTemplate = grasps;
    
    for (const [meetingId, orchestrator] of this.orchestrators) {
      orchestrator.rebuildGrasps(grasps);
    }

    console.log(JSON.stringify({
      type: 'orchestrator.manager.grasps.rebuilt',
      meetingCount: this.orchestrators.size,
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
      meetingId: string;
      lastActivityTime: number;
      messageCount: number;
    }>;
  } {
    const meetings = Array.from(this.orchestrators.entries()).map(
      ([meetingId, orchestrator]) => ({
        meetingId,
        lastActivityTime: orchestrator.getLastActivityTime(),
        messageCount: orchestrator.getMessageCount(),
      })
    );

    return {
      totalMeetings: this.orchestrators.size,
      meetings,
    };
  }

  /**
   * クリーンアップ（シャットダウン時）
   */
  cleanup(): void {
    for (const [meetingId, orchestrator] of this.orchestrators) {
      orchestrator.cleanup();
    }
    this.orchestrators.clear();
    console.log(JSON.stringify({
      type: 'orchestrator.manager.shutdown',
      ts: Date.now()
    }));
  }
}
