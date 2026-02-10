import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  OrchestratorManager,
} from './orchestratorManager';
import { Grasp } from './grasp';

// Mock graspConfigLoader to avoid DynamoDB dependency
// Note: vi.mock must be called before importing the mocked module
vi.mock('./graspConfigLoader', () => ({
  loadGraspsForMeeting: vi.fn(),
}));

// Import after mocking to ensure the mock is applied
import { loadGraspsForMeeting } from './graspConfigLoader';

describe('OrchestratorManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getOrCreateMeeting', async () => {
    // Create mock LLM client
    const mockLLMClient = {
      invoke: vi.fn().mockResolvedValue({
        result: null,
        prompt: '',
        rawResponse: '',
      }),
    };

    // Create real Grasp instances for testing
    const mockGrasps: Grasp[] = [
      new Grasp(
        {
          nodeId: 'test-grasp-1',
          promptTemplate: 'test prompt',
          cooldownMs: 1000,
          outputHandler: 'chat',
        },
        mockLLMClient
      ),
      new Grasp(
        {
          nodeId: 'test-grasp-2',
          promptTemplate: 'test prompt 2',
          cooldownMs: 2000,
          outputHandler: 'note',
          noteTag: 'test-tag',
        },
        mockLLMClient
      ),
    ];
    vi.mocked(loadGraspsForMeeting).mockResolvedValue(mockGrasps);

    // Arrange
    const sut = new OrchestratorManager(
        async (meetingId) => {
          return {};
        },
        {
          maxMeetings: 100,
          meetingTimeoutMs: 43200000,
          llmClient: mockLLMClient, // Use the mock LLM client
        }
    );
    // Act
    const meeting = await sut.getOrCreateMeeting('test-meeting-001');
    // Assert
    expect(meeting.meetingId).toBe('test-meeting-001');
    expect(meeting.grasps).toBeTruthy();
    expect(meeting.grasps).toHaveLength(2);
    expect(loadGraspsForMeeting).toHaveBeenCalledOnce();
    expect(loadGraspsForMeeting).toHaveBeenCalledWith(
      'test-meeting-001',
      'ap-northeast-1',
      'timtam-grasp-configs',
      'timtam-meetings-metadata',
      mockLLMClient
    );
    // Verify that LLM client is not invoked during getOrCreateMeeting
    expect(mockLLMClient.invoke).not.toHaveBeenCalled();
  });
});
