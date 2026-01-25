import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { RecallAPIClient, CreateBotRequest, MeetingPlatform, VALID_PLATFORMS, isMeetingPlatform } from '@timtam/shared';

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const MEETINGS_METADATA_TABLE = process.env.MEETINGS_METADATA_TABLE || 'timtam-meetings-metadata';
const RECALL_API_KEY = process.env.RECALL_API_KEY || '';
const RECALL_WEBHOOK_URL = process.env.RECALL_WEBHOOK_URL || ''; // e.g., https://api.timtam.example.com/recall/webhook

const ddbClient = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: {
    removeUndefinedValues: true, // Remove undefined values from items
  },
});
const recallClient = new RecallAPIClient({ apiKey: RECALL_API_KEY });

/**
 * POST /recall/meetings/join
 *
 * Recall.aiボットを会議に参加させる
 *
 * Request body:
 * {
 *   meetingUrl: string;        // Zoom/Meet/Teams URL
 *   platform: "zoom" | "google_meet" | "microsoft_teams" | "webex";
 *   botName?: string;          // デフォルト: "Timtam AI"
 *   graspConfigId?: string;    // Grasp設定ID (オプション、指定しない場合はデフォルト設定を使用)
 * }
 *
 * Response:
 * {
 *   meetingId: string;         // botId
 *   meetingCode: string;       // Attendee用の短いコード
 *   status: "starting";
 * }
 */
export const joinHandler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    if (!event.body) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Request body is required' }),
      };
    }

    let parsedBody: any;
    try {
      parsedBody = JSON.parse(event.body);
    } catch {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Request body must be valid JSON' }),
      };
    }

    const { meetingUrl, platform, botName, graspConfigId } = parsedBody;
    // Validate inputs
    if (!meetingUrl || typeof meetingUrl !== 'string') {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'meetingUrl is required and must be a string' }),
      };
    }

    if (!isMeetingPlatform(platform)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `platform must be one of: ${VALID_PLATFORMS.join(', ')}` }),
      };
    }

    // Validate RECALL_WEBHOOK_URL
    if (!RECALL_WEBHOOK_URL) {
      console.error('RECALL_WEBHOOK_URL is not set');
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Server configuration error: RECALL_WEBHOOK_URL not set' }),
      };
    }

    // Validate RECALL_API_KEY
    if (!RECALL_API_KEY) {
      console.error('RECALL_API_KEY is not set');
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Server configuration error: RECALL_API_KEY not set' }),
      };
    }

    // Create Recall.ai bot
    const createBotRequest: CreateBotRequest = {
      meeting_url: meetingUrl,
      bot_name: botName || 'Timtam AI',
      chat: {
        on_bot_join: {
          send_to: 'everyone',
          message: 'AI facilitator has joined the meeting.',
        },
      },
      recording_config: {
        transcript: {
          provider: {
            recallai_streaming: {
              language_code: 'ja', // Japanese transcription
            },
          },
        },
        realtime_endpoints: [
          {
            type: 'webhook',
            url: RECALL_WEBHOOK_URL,
            events: ['transcript.data'],
          },
        ],
      },
    };

    const bot = await recallClient.createBot(createBotRequest);

    // Generate meeting code (6桁の英数字)
    const meetingCode = await generateMeetingCode();

    // Save to DynamoDB
    const now = Date.now();
    await ddb.send(
      new PutCommand({
        TableName: MEETINGS_METADATA_TABLE,
        Item: {
          meetingId: bot.id, // PK
          platform: 'recall',
          status: 'active',
          createdAt: now,
          meetingCode,
          graspConfigId: graspConfigId || undefined, // Store config ID if provided
          recallBot: {
            botId: bot.id,
            meetingUrl,
            platform,
            botName: bot.bot_name,
            status: bot.status,
            statusMessage: bot.status_message,
          },
        },
      })
    );

    console.log(JSON.stringify({
      type: 'recall.meeting.joined',
      meetingId: bot.id,
      platform,
      meetingCode,
      graspConfigId: graspConfigId || 'default',
      timestamp: now,
    }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meetingId: bot.id,
        meetingCode,
        status: bot.status,
      }),
    };
  } catch (err: any) {
    console.error('Error joining Recall.ai meeting', {
      error: err?.message || err,
      stack: err?.stack,
    });

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to join meeting' }),
    };
  }
};

/**
 * GET /recall/meetings/{meetingId}
 *
 * 会議状態を取得
 *
 * Response:
 * {
 *   meetingId: string;
 *   platform: "recall";
 *   status: "active" | "ended";
 *   recallBot: { ... };
 * }
 */
export const getHandler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const meetingId = event.pathParameters?.meetingId;

    if (!meetingId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'meetingId is required in path' }),
      };
    }

    // Get from DynamoDB
    const result = await ddb.send(
      new GetCommand({
        TableName: MEETINGS_METADATA_TABLE,
        Key: { meetingId },
      })
    );

    if (!result.Item) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Meeting not found' }),
      };
    }

    // Optionally sync with Recall.ai bot status
    if (result.Item.platform === 'recall' && result.Item.recallBot?.botId) {
      try {
        const bot = await recallClient.getBot(result.Item.recallBot.botId);
        result.Item.recallBot.status = bot.status;
        result.Item.recallBot.statusMessage = bot.status_message;
      } catch (err: any) {
        console.warn('Failed to sync bot status from Recall.ai', {
          meetingId,
          error: err?.message,
        });
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result.Item),
    };
  } catch (err: any) {
    console.error('Error getting meeting', {
      error: err?.message || err,
      stack: err?.stack,
    });

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to get meeting' }),
    };
  }
};

/**
 * DELETE /recall/meetings/{meetingId}
 *
 * ボットを会議から退出させる
 *
 * Response:
 * {
 *   success: true
 * }
 */
export const leaveHandler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const meetingId = event.pathParameters?.meetingId;

    if (!meetingId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'meetingId is required in path' }),
      };
    }

    // Get from DynamoDB
    const result = await ddb.send(
      new GetCommand({
        TableName: MEETINGS_METADATA_TABLE,
        Key: { meetingId },
      })
    );

    if (!result.Item) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Meeting not found' }),
      };
    }

    // Remove Recall.ai bot from call
    if (result.Item.platform === 'recall' && result.Item.recallBot?.botId) {
      try {
        await recallClient.leaveCall(result.Item.recallBot.botId);
      } catch (err: any) {
        // If leaveCall fails, the bot might not be in a meeting yet - try delete instead
        if (err?.message?.includes('405') || err?.message?.includes('400')) {
          console.warn('leaveCall failed, attempting deleteBot', { botId: result.Item.recallBot.botId });
          await recallClient.deleteBot(result.Item.recallBot.botId);
        } else {
          throw err;
        }
      }
    }

    // Update DynamoDB status
    const now = Date.now();
    try {
      await ddb.send(
        new UpdateCommand({
          TableName: MEETINGS_METADATA_TABLE,
          Key: { meetingId },
          UpdateExpression: 'SET #status = :status, #endedAt = :endedAt',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#endedAt': 'endedAt',
          },
          ExpressionAttributeValues: {
            ':status': 'ended',
            ':endedAt': now,
          },
        })
      );
    } catch (err: any) {
      console.error('Failed to update DynamoDB after bot deletion', {
        meetingId,
        error: err?.message || err,
        stack: err?.stack,
        note: 'Bot was successfully deleted from Recall.ai but DynamoDB update failed. Database is out of sync.',
        recovery: 'Manual intervention may be required to update the meeting status to "ended" in DynamoDB.',
      });
      throw err;
    }

    console.log(JSON.stringify({
      type: 'recall.meeting.left',
      meetingId,
      timestamp: now,
    }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true }),
    };
  } catch (err: any) {
    console.error('Error leaving meeting', {
      error: err?.message || err,
      stack: err?.stack,
    });

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to leave meeting' }),
    };
  }
};

/**
 * GET /attendee/meetings/{code}
 *
 * 会議コードでmeetingIdを取得（Attendee用）
 *
 * Response:
 * {
 *   meetingId: string;
 *   status: "active" | "ended";
 * }
 */
export const getMeetingByCodeHandler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const code = event.pathParameters?.code;

    if (!code) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'code is required in path' }),
      };
    }

    // Query by GSI: meetingCode-index
    const result = await ddb.send(
      new QueryCommand({
        TableName: MEETINGS_METADATA_TABLE,
        IndexName: 'meetingCode-index',
        KeyConditionExpression: '#meetingCode = :meetingCode',
        ExpressionAttributeNames: {
          '#meetingCode': 'meetingCode',
        },
        ExpressionAttributeValues: {
          ':meetingCode': code,
        },
        Limit: 1,
      })
    );

    if (!result.Items || result.Items.length === 0) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Meeting not found' }),
      };
    }

    const meeting = result.Items[0];

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meetingId: meeting.meetingId,
        status: meeting.status,
      }),
    };
  } catch (err: any) {
    console.error('Error getting meeting by code', {
      error: err?.message || err,
      stack: err?.stack,
    });

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to get meeting' }),
    };
  }
};

/**
 * 会議コード生成（6桁の英数字）
 * DynamoDB 上で衝突がないことを確認しながらランダム生成
 */
async function generateMeetingCode(maxRetries: number = 5): Promise<string> {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 類似文字を除外（O/0, I/1）

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    // Check DynamoDB (GSI: meetingCode-index) for existing usage of this code
    const result = await ddb.send(
      new QueryCommand({
        TableName: MEETINGS_METADATA_TABLE,
        IndexName: 'meetingCode-index',
        KeyConditionExpression: '#meetingCode = :meetingCode',
        ExpressionAttributeNames: {
          '#meetingCode': 'meetingCode',
        },
        ExpressionAttributeValues: {
          ':meetingCode': code,
        },
        Limit: 1,
      })
    );

    if (!result.Items || result.Items.length === 0) {
      // No collision detected; safe to use this code
      return code;
    }
  }

  throw new Error('Failed to generate a unique meeting code after maximum retries');
}
