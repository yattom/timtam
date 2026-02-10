import { describe, it, expect } from 'vitest';
import {
  OrchestratorManager,
} from './orchestratorManager';

describe('OrchestratorManager', () => {

  it('getOrCreateMeeting', async () => {
    // Arrange
    const sut = new OrchestratorManager(
        async (meetingId) => {
          return {};
        },
        {
          maxMeetings: 100,
          meetingTimeoutMs: 43200000,
          llmClient: {},
        }
    );
    // Act
    const meeting = await sut.getOrCreateMeeting('test-meeting-001');
    // Assert
    expect(meeting.meetingId).toBe('test-meeting-001');
    expect(meeting.grasps).toBeTruthy();
  });
});
