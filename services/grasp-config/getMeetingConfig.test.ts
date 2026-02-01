import { describe, it, expect, vi, beforeEach } from 'vitest';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { handler } from './getMeetingConfig';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
  vi.clearAllMocks();
});

const createMockEvent = (meetingId: string): APIGatewayProxyEventV2 => {
  return {
    pathParameters: { meetingId },
  } as any;
};

describe('getMeetingConfig', () => {
  const validYaml = `
grasps:
  - nodeId: "test-grasp"
    promptTemplate: "test prompt"
    intervalSec: 10
    outputHandler: "chat"
`;

  it('returns config when meeting has graspConfigId', async () => {
    const meetingId = 'meeting-123';
    const configId = 'test-config_20260201_120000';

    // Mock meeting metadata
    ddbMock.on(GetCommand, {
      TableName: expect.stringContaining('metadata'),
    }).resolves({
      Item: {
        meetingId,
        graspConfigId: configId,
      },
    });

    // Mock grasp config
    ddbMock.on(GetCommand, {
      TableName: expect.stringContaining('grasp-configs'),
    }).resolves({
      Item: {
        configId,
        name: 'Test Config',
        yaml: validYaml,
        createdAt: 1738411200000,
        updatedAt: 1738411200000,
      },
    });

    const event = createMockEvent(meetingId);
    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toMatchObject({
      ok: true,
      configId,
      name: 'Test Config',
      yaml: validYaml,
    });
  });

  it('returns null config when meeting has no graspConfigId', async () => {
    const meetingId = 'meeting-456';

    // Mock meeting metadata without graspConfigId
    ddbMock.on(GetCommand).resolves({
      Item: {
        meetingId,
        // No graspConfigId field
      },
    });

    const event = createMockEvent(meetingId);
    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toMatchObject({
      ok: true,
      configId: null,
      name: null,
      yaml: null,
    });
  });

  it('returns 404 when meeting not found', async () => {
    const meetingId = 'meeting-nonexistent';

    ddbMock.on(GetCommand).resolves({
      Item: undefined,
    });

    const event = createMockEvent(meetingId);
    const response = await handler(event);

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(false);
    expect(body.error).toContain('Meeting not found');
  });

  it('returns 404 when config not found', async () => {
    const meetingId = 'meeting-789';
    const configId = 'nonexistent-config';

    // Mock meeting metadata
    ddbMock.on(GetCommand, {
      TableName: expect.stringContaining('metadata'),
    }).resolves({
      Item: {
        meetingId,
        graspConfigId: configId,
      },
    });

    // Mock grasp config not found
    ddbMock.on(GetCommand, {
      TableName: expect.stringContaining('grasp-configs'),
    }).resolves({
      Item: undefined,
    });

    const event = createMockEvent(meetingId);
    const response = await handler(event);

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(false);
    expect(body.error).toContain('Configuration not found');
  });

  it('returns error when meetingId is missing', async () => {
    const event = {
      pathParameters: {},
    } as any;

    const response = await handler(event);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(false);
    expect(body.error).toContain('meetingId is required');
  });
});
