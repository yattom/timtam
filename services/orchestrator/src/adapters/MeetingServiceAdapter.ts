/**
 * Meeting Service Abstraction Layer
 *
 * This module provides a unified interface for different meeting service providers
 * (Chime SDK, Recall.ai, etc.) to abstract away implementation details.
 */

/**
 * Unified transcript event interface
 * Compatible with current AsrEvent structure
 */
export interface TranscriptEvent {
  /** Meeting identifier */
  meetingId: string;

  /** Speaker identifier (externalUserId || attendeeId || recall participant_id) */
  speakerId: string;

  /** Transcribed text */
  text: string;

  /** Whether this is a final transcript (true) or partial (false) */
  isFinal: boolean;

  /** Timestamp in epoch milliseconds */
  timestamp: number;

  /** Optional sequence number for ordering guarantee */
  sequenceNumber?: number;
}

/**
 * Meeting participant event
 */
export interface ParticipantEvent {
  type: 'join' | 'leave' | 'speaking' | 'muted';
  participantId: string;
  participantName?: string;
  timestamp: number;
}

/**
 * Meeting configuration for joining
 */
export interface MeetingInfo {
  /** Internal meeting ID for tracking */
  meetingId: string;

  /** Platform type */
  platform: 'chime' | 'zoom' | 'google_meet' | 'teams' | 'webex';

  /** Configuration for Chime SDK */
  chimeConfig?: {
    Meeting: {
      MeetingId: string;
      ExternalMeetingId: string;
      MediaRegion: string;
      MediaPlacement: any;
    };
    Attendee: {
      AttendeeId: string;
      ExternalUserId: string;
    };
  };

  /** Configuration for Recall.ai */
  recallConfig?: {
    /** Meeting URL (Zoom/Meet/Teams/etc.) */
    meetingUrl: string;

    /** Bot display name */
    botName?: string;

    /** Initial chat message when bot joins */
    joinMessage?: string;
  };
}

/**
 * Unified interface for meeting service providers
 *
 * Implementations: ChimeSDKAdapter, RecallAIAdapter
 */
export interface MeetingServiceAdapter {
  /**
   * Subscribe to transcript events
   * @param callback Function to handle incoming transcript events
   */
  onTranscript(callback: (event: TranscriptEvent) => void): void;

  /**
   * Send a message to the meeting chat
   * @param meetingId Meeting identifier
   * @param text Message text to send
   * @returns Promise that resolves when message is sent
   */
  sendMessage(meetingId: string, text: string): Promise<void>;

  /**
   * Send audio data to the meeting (optional, for future TTS integration)
   * @param meetingId Meeting identifier
   * @param audioData Audio data buffer
   * @returns Promise that resolves when audio is sent
   */
  sendAudio?(meetingId: string, audioData: Buffer): Promise<void>;

  /**
   * Join a meeting
   * @param meetingInfo Meeting configuration
   * @returns Promise that resolves when joined successfully
   */
  join(meetingInfo: MeetingInfo): Promise<void>;

  /**
   * Leave a meeting
   * @param meetingId Meeting identifier
   * @returns Promise that resolves when left successfully
   */
  leave(meetingId: string): Promise<void>;

  /**
   * Subscribe to participant events (optional)
   * @param callback Function to handle participant events
   */
  onParticipantEvent?(callback: (event: ParticipantEvent) => void): void;

  /**
   * Initialize the adapter
   * @returns Promise that resolves when adapter is ready
   */
  initialize(): Promise<void>;

  /**
   * Clean up resources
   * @returns Promise that resolves when cleanup is complete
   */
  shutdown(): Promise<void>;
}
