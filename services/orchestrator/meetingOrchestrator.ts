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
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

export interface MeetingConfig {
  meetingId: MeetingId;
  adapter: MeetingServiceAdapter;
  windowLines?: number;
  /** DynamoDB テーブル名（AI応答メッセージ保存用） */
  aiMessagesTable?: string;
  /** DynamoDBクライアント（オプション、テスト用） */
  ddbClient?: DynamoDBClient;
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
  private ddb?: DynamoDBDocumentClient;
  private aiMessagesTable?: string;

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

    // DynamoDB設定（オプショナル）
    if (config.aiMessagesTable) {
      this.aiMessagesTable = config.aiMessagesTable;
      const ddbClient = config.ddbClient || new DynamoDBClient({});
      this.ddb = DynamoDBDocumentClient.from(ddbClient);
    }

    console.log(JSON.stringify({
      type: 'meeting.created',
      meetingId: this.meetingId,
      adapter: this.adapter.constructor.name,
      graspCount: this.grasps.length,
      hasDdb: !!this.ddb,
      ts: Date.now()
    }));
  }

  // Notifierインターフェース実装
  async postChat(meetingId: MeetingId, message: string): Promise<void> {
    // 共通処理: DynamoDBにメッセージを保存（ファシリテーター画面がポーリングで取得）
    if (this.ddb && this.aiMessagesTable) {
      const timestamp = Date.now();
      const ttl = Math.floor(timestamp / 1000) + 86400; // 24時間後に削除

      try {
        await this.ddb.send(
          new PutCommand({
            TableName: this.aiMessagesTable,
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
          type: 'meeting.chat.stored',
          meetingId,
          messageLength: message.length,
          timestamp,
          stored: 'dynamodb',
        }));
      } catch (err: any) {
        console.error('Meeting: Failed to store chat message to DynamoDB', {
          error: err?.message || err,
          meetingId,
        });
        // DynamoDB保存失敗してもadapter.postChat()は続行する
      }
    }

    // サービス固有の処理（Recall.aiならAPI呼び出し、Chimeならなし）
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
