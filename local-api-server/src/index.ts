import express from 'express';
import cors from 'cors';
import { APIGatewayProxyEventV2 } from 'aws-lambda';

// Configure environment for LocalStack BEFORE importing Lambda handlers
// These environment variables should be set in docker-compose.yml
// The values here are fallbacks for running without docker-compose
process.env.AWS_ENDPOINT_URL = process.env.AWS_ENDPOINT_URL || 'http://localhost:4566';
process.env.AWS_REGION = process.env.AWS_REGION || 'ap-northeast-1';
process.env.MEETINGS_METADATA_TABLE = process.env.MEETINGS_METADATA_TABLE || 'timtam-meetings-metadata';
process.env.AI_MESSAGES_TABLE = process.env.AI_MESSAGES_TABLE || 'timtam-ai-messages';
process.env.GRASP_CONFIGS_TABLE = process.env.GRASP_CONFIGS_TABLE || 'timtam-grasp-configs';
process.env.CONFIG_TABLE_NAME = process.env.CONFIG_TABLE_NAME || 'timtam-orchestrator-config';
process.env.CONTROL_SQS_URL = process.env.CONTROL_SQS_URL || 'http://localhost:4566/000000000000/OrchestratorControlQueue';
process.env.RECALL_API_KEY = process.env.RECALL_API_KEY || 'test-key';
process.env.RECALL_WEBHOOK_URL = process.env.RECALL_WEBHOOK_URL || 'http://localhost:3000/recall/webhook';
process.env.TRANSCRIPT_QUEUE_URL = process.env.TRANSCRIPT_QUEUE_URL || 'http://localhost:4566/000000000000/transcript-asr.fifo';
process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || 'test';
process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'test';

const LOCALSTACK_ENDPOINT = process.env.AWS_ENDPOINT_URL;
const AWS_REGION = process.env.AWS_REGION;
const MEETINGS_METADATA_TABLE = process.env.MEETINGS_METADATA_TABLE;

// Import Lambda handlers directly AFTER setting environment variables
import { listHandler, getHandler, joinHandler, leaveHandler } from '../../services/meeting-api/recallMeetings';
import { handler as webhookHandler } from '../../services/meeting-api/recallWebhook';
import { getMessages } from '../../services/ai-messages/handler';
import { handler as saveConfig } from '../../services/grasp-config/saveConfig';
import { handler as getMeetingConfig } from '../../services/grasp-config/getMeetingConfig';
import { handler as getConfigs } from '../../services/grasp-config/getConfigs';
import { handler as savePreset } from '../../services/grasp-config/savePreset';
import { handler as getConfig } from '../../services/grasp-config/getConfig';
import { handler as applyConfigToMeeting } from '../../services/grasp-config/applyConfigToMeeting';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

console.log('============================================================');
console.log('🚀 Timtam Local API Server');
console.log('============================================================');
console.log(`Server will run at: http://localhost:${PORT}`);
console.log(`AWS endpoint: ${LOCALSTACK_ENDPOINT}`);
console.log(`DynamoDB table: ${MEETINGS_METADATA_TABLE}`);
console.log(`Region: ${AWS_REGION}`);
console.log('============================================================');
console.log('Using ACTUAL Lambda handlers from services/meeting-api/');
console.log('============================================================');

/**
 * Helper: Convert Express request to API Gateway event
 */
function createApiGatewayEvent(
  req: express.Request,
  pathParameters?: Record<string, string>
): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: `${req.method} ${req.path}`,
    rawPath: req.path,
    rawQueryString: new URLSearchParams(req.query as any).toString(),
    headers: req.headers as Record<string, string>,
    queryStringParameters: req.query as Record<string, string> | undefined,
    pathParameters,
    body: req.body ? JSON.stringify(req.body) : undefined,
    isBase64Encoded: false,
    requestContext: {
      accountId: 'local',
      apiId: 'local-api',
      domainName: 'localhost',
      domainPrefix: 'local',
      http: {
        method: req.method,
        path: req.path,
        protocol: 'HTTP/1.1',
        sourceIp: req.ip || '127.0.0.1',
        userAgent: req.get('user-agent') || '',
      },
      requestId: `local-${Date.now()}`,
      routeKey: `${req.method} ${req.path}`,
      stage: 'local',
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
  };
}

/**
 * Helper: Send Lambda response via Express
 */
function sendLambdaResponse(res: express.Response, lambdaResponse: any) {
  if (!lambdaResponse) {
    res.status(500).json({ error: 'Lambda handler returned no response' });
    return;
  }

  const statusCode = lambdaResponse.statusCode || 200;
  const headers = lambdaResponse.headers || {};
  const body = lambdaResponse.body;

  // Set headers
  Object.entries(headers).forEach(([key, value]) => {
    res.setHeader(key, value as string);
  });

  // Send response
  res.status(statusCode);

  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      res.json(parsed);
    } catch {
      res.send(body);
    }
  } else {
    res.json(body);
  }
}


/**
 * GET /recall/meetings/:meetingId
 *
 * Uses the ACTUAL Lambda handler from services/meeting-api/recallMeetings.ts
 */
function addRoute(
    method: "get" | "post" | "put" | "delete",
    path: string,
    handler: Function,
    extractor: Function) {
  const defineRoute = {
    'get': app.get.bind(app),
    'post': app.post.bind(app),
    'put': app.put.bind(app),
    'delete': app.delete.bind(app),
  }[method];
  defineRoute(path, async (req, res) => {
    try {
      console.log('[' + method + ' ' + path + '] Request received', {
        query: req.query,
        timestamp: new Date().toISOString(),
      });

      // Create API Gateway event with path parameters
      console.log('event parameters: ', extractor(req));
      const event = createApiGatewayEvent(req, extractor(req));

      console.log('[' + method + ' ' + path + '] Calling Lambda handler (' + handler.name + ')');

      // Call the ACTUAL Lambda handler
      const lambdaResponse = await handler(event, {} as any, () => {});

      console.log('[' + method + ' ' + path + '] Lambda handler returned', {
        statusCode: lambdaResponse?.statusCode,
      });

      // Send Lambda response via Express
      sendLambdaResponse(res, lambdaResponse);
    } catch (err: any) {
      console.error('[' + method + ' ' + path + '] Error', {
        error: err?.message || err,
        stack: err?.stack,
      });

      res.status(500).json({ error: 'Failed to ' + handler.name + ' at ' + path });
    }
  })

  // Log registered endpoint
  console.log(`  ${method.toUpperCase().padEnd(6)} ${path}`);
};

console.log('Available endpoints:');
console.log('  GET    /health');
addRoute('get', '/recall/meetings', listHandler, (req) => ({}) );
addRoute('get', '/recall/meetings/:meetingId', getHandler, (req) => ({ meetingId: req.params.meetingId }) );
addRoute('post', '/recall/meetings/join', joinHandler, (req) => ({}) );
addRoute('post', '/recall/webhook', webhookHandler, (req) => ({}) );
addRoute('delete', '/recall/meetings/:meetingId', leaveHandler, (req) => ({ meetingId: req.params.meetingId }) );
addRoute('get', '/meetings/:meetingId/messages', getMessages, (req) => ({ meetingId: req.params.meetingId }) );
addRoute('post', '/grasp/configs', saveConfig, (req) => ({}) );
addRoute('get', '/grasp/configs', getConfigs, (req) => ({}) );
addRoute('get', '/grasp/configs/:configId', getConfig, (req) => ({ configId: req.params.configId }) );
addRoute('post', '/grasp/presets', savePreset, (req) => ({}) );
addRoute('get', '/meetings/:meetingId/grasp-config', getMeetingConfig, (req) => ({ meetingId: req.params.meetingId }) );
addRoute('post', '/meetings/:meetingId/grasp-config', applyConfigToMeeting, (req) => ({ meetingId: req.params.meetingId }) );

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'local-api-server',
    timestamp: new Date().toISOString(),
    mode: 'Using actual Lambda handlers',
    endpoints: {
      aws: LOCALSTACK_ENDPOINT,
      table: MEETINGS_METADATA_TABLE,
    },
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    path: req.path,
    method: req.method,
  });
});

// Start server
app.listen(PORT, () => {
  console.log('');
  console.log(`✓ Server is running on http://localhost:${PORT}`);
  console.log('');
});
