// OrchestratorManager: 複数ミーティングのオーケストレーターを管理
import { Meeting } from './meetingOrchestrator';
import { Grasp, MeetingId, Metrics, LLMClient } from './grasp';
import { TranscriptEvent, MeetingServiceAdapter } from '@timtam/shared';
import { loadGraspsForMeeting } from './graspConfigLoader';

export type AdapterFactory = (meetingId: MeetingId) => Promise<MeetingServiceAdapter>;

export interface OrchestratorManagerConfig {
  maxMeetings?: number; // 最大同時ミーティング数
  meetingTimeoutMs?: number; // ミーティングの非アクティブタイムアウト
  region?: string; // AWS region
  graspConfigsTable?: string; // Grasp configs table name
  meetingsMetadataTable?: string; // Meetings metadata table name
  llmClient?: LLMClient; // LLM client for building Grasps
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
  private adapterFactory: AdapterFactory;

  constructor(
    adapterFactory: AdapterFactory,
    config?: OrchestratorManagerConfig
  ) {
    this.adapterFactory = adapterFactory;
    this.config = {
      maxMeetings: config?.maxMeetings || 100,
      meetingTimeoutMs: config?.meetingTimeoutMs || 43200000, // 12時間 (12 * 60 * 60 * 1000)
      region: config?.region || 'ap-northeast-1',
      graspConfigsTable: config?.graspConfigsTable || 'timtam-grasp-configs',
      meetingsMetadataTable: config?.meetingsMetadataTable || 'timtam-meetings-metadata',
      llmClient: config?.llmClient as any, // Will be set by worker
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
  async getOrCreateMeeting(meetingId: MeetingId): Promise<Meeting> {
    let meeting = this.meetings.get(meetingId);

    if (!meeting) {
      // 最大数チェックとクリーンアップ
      if (this.meetings.size >= this.config.maxMeetings) {
        this.cleanupInactiveMeetings();
      }

      // Load Grasp configuration for this meeting
      const grasps = await loadGraspsForMeeting(
        meetingId,
        this.config.region,
        this.config.graspConfigsTable,
        this.config.meetingsMetadataTable,
        this.config.llmClient
      );

      // Platform判別してAdapterを作成
      const adapter = await this.adapterFactory(meetingId);

      // 新しいオーケストレーターを作成
      meeting = new Meeting(
        { meetingId, adapter },
        grasps
      );
      this.meetings.set(meetingId, meeting);

      console.log(JSON.stringify({
        type: 'orchestrator.manager.meeting.created',
        meetingId,
        platform: adapter.constructor.name,
        totalMeetings: this.meetings.size,
        graspCount: grasps.length,
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
   * Transcriptイベントを適切なオーケストレーターに振り分けて処理
   */
  async processTranscriptEvent(
    ev: TranscriptEvent,
    metrics: Metrics
  ): Promise<void> {
    const meeting = await this.getOrCreateMeeting(ev.meetingId);
    await meeting.processTranscriptEvent(ev, metrics);
  }

  /**
   * すべてのミーティングの待機Graspを定期的に処理
   * 並列処理により効率化
   */
  async processAllWaitingGrasps(
    metrics: Metrics
  ): Promise<number> {
    // Process all meeting waiting Grasps in parallel for better performance
    const results = await Promise.all(
      Array.from(this.meetings.values()).map(async (meeting) => {
        return await meeting.processWaitingGraspsPeriodically(metrics);
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
   * Set LLM client for building Grasps
   * Must be called before any meetings are created
   */
  setLLMClient(llmClient: LLMClient): void {
    this.config.llmClient = llmClient;
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
