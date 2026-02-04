import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import {
  loadGraspsForMeeting,
  MissingGraspConfigIdError,
  buildGraspsFromDefinition,
  loadGraspConfigById,
} from './graspConfigLoader';
import { LLMClient } from './grasp';

const ddbMock = mockClient(DynamoDBDocumentClient);

// Mock LLM client for testing
const mockLLMClient: LLMClient = {
  generateText: vi.fn().mockResolvedValue('mock response'),
};

describe('graspConfigLoader', () => {
  beforeEach(() => {
    ddbMock.reset();
    vi.clearAllMocks();
  });

  describe('MissingGraspConfigIdError', () => {
    it('graspConfigIdが欠落している場合にMissingGraspConfigIdErrorがスローされる', async () => {
      // Meeting metadata without graspConfigId
      ddbMock.on(GetCommand).resolves({
        Item: {
          meetingId: 'test-meeting-123',
          // graspConfigId is missing
        },
      });

      await expect(
        loadGraspsForMeeting(
          'test-meeting-123',
          'us-east-1',
          'grasp-configs-table',
          'meetings-metadata-table',
          mockLLMClient
        )
      ).rejects.toThrow(MissingGraspConfigIdError);

      await expect(
        loadGraspsForMeeting(
          'test-meeting-123',
          'us-east-1',
          'grasp-configs-table',
          'meetings-metadata-table',
          mockLLMClient
        )
      ).rejects.toThrow('graspConfigId is undefined in meeting metadata');
    });

    it('graspConfigIdがundefinedの場合にMissingGraspConfigIdErrorがスローされる', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          meetingId: 'test-meeting-123',
          graspConfigId: undefined,
        },
      });

      await expect(
        loadGraspsForMeeting(
          'test-meeting-123',
          'us-east-1',
          'grasp-configs-table',
          'meetings-metadata-table',
          mockLLMClient
        )
      ).rejects.toThrow(MissingGraspConfigIdError);
    });

    it('graspConfigIdがnullの場合にMissingGraspConfigIdErrorがスローされる', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: {
          meetingId: 'test-meeting-123',
          graspConfigId: null,
        },
      });

      await expect(
        loadGraspsForMeeting(
          'test-meeting-123',
          'us-east-1',
          'grasp-configs-table',
          'meetings-metadata-table',
          mockLLMClient
        )
      ).rejects.toThrow(MissingGraspConfigIdError);
    });

    it('ミーティングメタデータが存在しない場合にMissingGraspConfigIdErrorがスローされる', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: undefined,
      });

      await expect(
        loadGraspsForMeeting(
          'test-meeting-123',
          'us-east-1',
          'grasp-configs-table',
          'meetings-metadata-table',
          mockLLMClient
        )
      ).rejects.toThrow(MissingGraspConfigIdError);
    });
  });

  describe('他のエラーの場合のフォールバック動作', () => {
    it('grasp設定が見つからない場合はデフォルトにフォールバックする', async () => {
      // Meeting has graspConfigId
      ddbMock
        .on(GetCommand, {
          TableName: 'meetings-metadata-table',
        })
        .resolves({
          Item: {
            meetingId: 'test-meeting-123',
            graspConfigId: 'CUSTOM-CONFIG-001',
          },
        });

      // But config doesn't exist
      ddbMock
        .on(GetCommand, {
          TableName: 'grasp-configs-table',
        })
        .resolves({
          Item: undefined,
        });

      const grasps = await loadGraspsForMeeting(
        'test-meeting-123',
        'us-east-1',
        'grasp-configs-table',
        'meetings-metadata-table',
        mockLLMClient
      );

      // Should fall back to default config (3 grasps)
      expect(grasps).toHaveLength(3);
      expect(grasps[0].config.nodeId).toBe('friendly-nodder');
      expect(grasps[1].config.nodeId).toBe('argument-observer');
      expect(grasps[2].config.nodeId).toBe('summary-provider');
    });

    it('grasp設定のYAMLが不正な場合はデフォルトにフォールバックする', async () => {
      ddbMock
        .on(GetCommand, {
          TableName: 'meetings-metadata-table',
        })
        .resolves({
          Item: {
            meetingId: 'test-meeting-123',
            graspConfigId: 'CUSTOM-CONFIG-001',
          },
        });

      // Config exists but YAML is invalid
      ddbMock
        .on(GetCommand, {
          TableName: 'grasp-configs-table',
        })
        .resolves({
          Item: {
            configId: 'CUSTOM-CONFIG-001',
            yaml: 'invalid: yaml: [[[',
          },
        });

      const grasps = await loadGraspsForMeeting(
        'test-meeting-123',
        'us-east-1',
        'grasp-configs-table',
        'meetings-metadata-table',
        mockLLMClient
      );

      // Should fall back to default config
      expect(grasps).toHaveLength(3);
      expect(grasps[0].config.nodeId).toBe('friendly-nodder');
    });

    it('DynamoDBアクセスエラーでもデフォルトにフォールバックする', async () => {
      ddbMock
        .on(GetCommand, {
          TableName: 'meetings-metadata-table',
        })
        .resolves({
          Item: {
            meetingId: 'test-meeting-123',
            graspConfigId: 'CUSTOM-CONFIG-001',
          },
        });

      // DynamoDB error when loading config
      ddbMock
        .on(GetCommand, {
          TableName: 'grasp-configs-table',
        })
        .rejects(new Error('DynamoDB service error'));

      const grasps = await loadGraspsForMeeting(
        'test-meeting-123',
        'us-east-1',
        'grasp-configs-table',
        'meetings-metadata-table',
        mockLLMClient
      );

      // Should fall back to default config
      expect(grasps).toHaveLength(3);
    });
  });

  describe('正常系', () => {
    it('有効なgraspConfigIdでgrasp設定をロードできる', async () => {
      const customYaml = `
grasps:
  - nodeId: custom-grasp
    intervalSec: 30
    outputHandler: chat
    promptTemplate: |
      Custom prompt template
`;

      ddbMock
        .on(GetCommand, {
          TableName: 'meetings-metadata-table',
        })
        .resolves({
          Item: {
            meetingId: 'test-meeting-123',
            graspConfigId: 'CUSTOM-CONFIG-001',
          },
        });

      ddbMock
        .on(GetCommand, {
          TableName: 'grasp-configs-table',
        })
        .resolves({
          Item: {
            configId: 'CUSTOM-CONFIG-001',
            yaml: customYaml,
          },
        });

      const grasps = await loadGraspsForMeeting(
        'test-meeting-123',
        'us-east-1',
        'grasp-configs-table',
        'meetings-metadata-table',
        mockLLMClient
      );

      expect(grasps).toHaveLength(1);
      expect(grasps[0].config.nodeId).toBe('custom-grasp');
      expect(grasps[0].config.cooldownMs).toBe(30000);
      expect(grasps[0].config.outputHandler).toBe('chat');
    });

    it('DEFAULT設定IDで複数のgraspをロードできる', async () => {
      const defaultYaml = `
grasps:
  - nodeId: grasp-1
    intervalSec: 10
    outputHandler: chat
    promptTemplate: "Prompt 1 {{NOTES:notes-tag}}"
  - nodeId: grasp-2
    intervalSec: 20
    outputHandler: note
    noteTag: notes-tag
    promptTemplate: "Prompt 2"
`;

      ddbMock
        .on(GetCommand, {
          TableName: 'meetings-metadata-table',
        })
        .resolves({
          Item: {
            meetingId: 'test-meeting-456',
            graspConfigId: 'DEFAULT-20260125-0123',
          },
        });

      ddbMock
        .on(GetCommand, {
          TableName: 'grasp-configs-table',
        })
        .resolves({
          Item: {
            configId: 'DEFAULT-20260125-0123',
            yaml: defaultYaml,
          },
        });

      const grasps = await loadGraspsForMeeting(
        'test-meeting-456',
        'us-east-1',
        'grasp-configs-table',
        'meetings-metadata-table',
        mockLLMClient
      );

      expect(grasps).toHaveLength(2);
      expect(grasps[0].config.nodeId).toBe('grasp-1');
      expect(grasps[1].config.nodeId).toBe('grasp-2');
      expect(grasps[1].config.noteTag).toBe('notes-tag');
    });
  });

  describe('MissingGraspConfigIdError vs 他のエラーの区別', () => {
    it('MissingGraspConfigIdErrorは再スローされ、他のエラーはフォールバックする', async () => {
      // Test 1: MissingGraspConfigIdError should be rethrown
      ddbMock.on(GetCommand).resolves({
        Item: { meetingId: 'test-1' },
        // graspConfigId missing
      });

      await expect(
        loadGraspsForMeeting(
          'test-1',
          'us-east-1',
          'grasp-configs-table',
          'meetings-metadata-table',
          mockLLMClient
        )
      ).rejects.toThrow(MissingGraspConfigIdError);

      // Test 2: Other errors should fall back
      ddbMock.reset();
      ddbMock
        .on(GetCommand, {
          TableName: 'meetings-metadata-table',
        })
        .resolves({
          Item: {
            meetingId: 'test-2',
            graspConfigId: 'SOME-CONFIG',
          },
        });

      ddbMock
        .on(GetCommand, {
          TableName: 'grasp-configs-table',
        })
        .rejects(new Error('Some other error'));

      // Should not throw, should fall back
      const grasps = await loadGraspsForMeeting(
        'test-2',
        'us-east-1',
        'grasp-configs-table',
        'meetings-metadata-table',
        mockLLMClient
      );

      expect(grasps).toHaveLength(3); // Default config
    });
  });
});
