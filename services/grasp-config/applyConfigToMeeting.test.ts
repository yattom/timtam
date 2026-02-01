import { describe, it, expect, vi, beforeEach } from 'vitest';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { handler } from './applyConfigToMeeting';

const ddbMock = mockClient(DynamoDBDocumentClient);
const sqsMock = mockClient(SQSClient);

beforeEach(() => {
  ddbMock.reset();
  sqsMock.reset();
  vi.clearAllMocks();
});

const createMockEvent = (
  meetingId: string,
  body: any
): APIGatewayProxyEventV2 => {
  return {
    pathParameters: { meetingId },
    body: JSON.stringify(body),
  } as any;
};

describe('applyConfigToMeeting', () => {
  const validYaml = `
grasps:
  - nodeId: "test-grasp"
    promptTemplate: "test prompt"
    intervalSec: 10
    outputHandler: "chat"
`;

  it('updates meeting metadata with graspConfigId when configId is provided', async () => {
    const meetingId = 'meeting-123';
    const configId = 'test-config_20260201_120000';

    ddbMock.on(GetCommand).resolves({
      Item: {
        configId,
        name: 'Test Config',
        yaml: validYaml,
      },
    });

    sqsMock.on(SendMessageCommand).resolves({});
    ddbMock.on(UpdateCommand).resolves({});

    const event = createMockEvent(meetingId, { configId });
    const response = await handler(event);

    expect(response.statusCode).toBe(200);

    // Verify UpdateCommand was called to save graspConfigId
    const updateCalls = ddbMock.commandCalls(UpdateCommand);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].args[0].input).toMatchObject({
      TableName: expect.stringContaining('metadata'),
      Key: { meetingId },
      UpdateExpression: 'SET graspConfigId = :configId',
      ExpressionAttributeValues: {
        ':configId': configId,
      },
    });
  });

  it('updates meeting metadata with null when yaml is provided directly', async () => {
    const meetingId = 'meeting-456';

    sqsMock.on(SendMessageCommand).resolves({});
    ddbMock.on(UpdateCommand).resolves({});

    const event = createMockEvent(meetingId, { yaml: validYaml });
    const response = await handler(event);

    expect(response.statusCode).toBe(200);

    // Verify UpdateCommand was called with null configId
    const updateCalls = ddbMock.commandCalls(UpdateCommand);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].args[0].input).toMatchObject({
      TableName: expect.stringContaining('metadata'),
      Key: { meetingId },
      UpdateExpression: 'SET graspConfigId = :configId',
      ExpressionAttributeValues: {
        ':configId': null,
      },
    });
  });

  it('sends control message to SQS after updating metadata', async () => {
    const meetingId = 'meeting-789';
    const configId = 'test-config_20260201_130000';

    ddbMock.on(GetCommand).resolves({
      Item: {
        configId,
        name: 'Test Config 2',
        yaml: validYaml,
      },
    });

    sqsMock.on(SendMessageCommand).resolves({});
    ddbMock.on(UpdateCommand).resolves({});

    const event = createMockEvent(meetingId, { configId });
    await handler(event);

    // Verify metadata update happens before SQS message
    const updateCalls = ddbMock.commandCalls(UpdateCommand);
    const sqsCalls = sqsMock.commandCalls(SendMessageCommand);

    expect(updateCalls).toHaveLength(1);
    expect(sqsCalls).toHaveLength(1);

    // Verify SQS message content
    const sqsMessage = JSON.parse(sqsCalls[0].args[0].input.MessageBody as string);
    expect(sqsMessage).toMatchObject({
      type: 'apply_grasp_config',
      meetingId,
      yaml: validYaml.trim(),
      configName: 'Test Config 2',
    });
  });

  it('returns error when meeting metadata update fails', async () => {
    const meetingId = 'meeting-error';
    const configId = 'test-config_20260201_140000';

    ddbMock.on(GetCommand).resolves({
      Item: {
        configId,
        name: 'Test Config 3',
        yaml: validYaml,
      },
    });

    // Simulate metadata update failure
    ddbMock.on(UpdateCommand).rejects(new Error('DynamoDB update failed'));

    const event = createMockEvent(meetingId, { configId });
    const response = await handler(event);

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(false);
    expect(body.error).toContain('DynamoDB update failed');

    // Verify SQS message was not sent
    const sqsCalls = sqsMock.commandCalls(SendMessageCommand);
    expect(sqsCalls).toHaveLength(0);
  });
});
