import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { RecallAPIClient, CreateBotRequest, VALID_PLATFORMS, isMeetingPlatform, buildCreateBotRequest } from '@timtam/shared';

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const MEETINGS_METADATA_TABLE = process.env.MEETINGS_METADATA_TABLE || 'timtam-meetings-metadata';
const GRASP_CONFIGS_TABLE = process.env.GRASP_CONFIGS_TABLE || 'timtam-grasp-configs';
const RECALL_API_KEY = process.env.RECALL_API_KEY || '';
const RECALL_API_BASE_URL = process.env.RECALL_API_BASE_URL; // Optional: for local dev, use http://stub-recall:8080
const RECALL_WEBHOOK_URL = process.env.RECALL_WEBHOOK_URL || ''; // e.g., https://api.timtam.example.com/recall/webhook

// Recall.ai transcription provider configuration
const RECALL_TRANSCRIPTION_PROVIDER = process.env.RECALL_TRANSCRIPTION_PROVIDER || 'deepgram_streaming';
const RECALL_TRANSCRIPTION_LANGUAGE = process.env.RECALL_TRANSCRIPTION_LANGUAGE || 'auto';

const ddbClient = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: {
    removeUndefinedValues: true, // Remove undefined values from items
  },
});
const recallClient = new RecallAPIClient({
  apiKey: RECALL_API_KEY,
  ...(RECALL_API_BASE_URL && { apiBaseUrl: RECALL_API_BASE_URL })
});

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

    // For local development: use local Recall.ai stub server
    const isLocalDevelopment = meetingUrl === 'http://localhost';
    const clientToUse = isLocalDevelopment
      ? new RecallAPIClient({
          apiKey: RECALL_API_KEY,
          apiBaseUrl: 'http://recall-stub:8080', // Local stub server
        })
      : recallClient;
    if (isLocalDevelopment) {
      console.log('[LOCAL DEV] Using local Recall.ai stub server at http://recall-stub:8080');
    }


    if(!isLocalDevelopment) {
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
    }

    // Create Recall.ai bot request
    const createBotRequest: CreateBotRequest = buildCreateBotRequest({
      meetingUrl,
      botName: botName || 'Timtam AI',
      webhookUrl: isLocalDevelopment ? 'http://api-server:3000' : RECALL_WEBHOOK_URL,
      transcriptionProvider: RECALL_TRANSCRIPTION_PROVIDER === 'deepgram_streaming' ? 'deepgram_streaming' : 'recallai_streaming',
      transcriptionLanguage: RECALL_TRANSCRIPTION_LANGUAGE,
    });

    const bot = await clientToUse.createBot(createBotRequest);

    // Generate meeting code (6桁の英数字)
    const meetingCode = await generateMeetingCode();

    // Get DEFAULT grasp config ID if not provided
    let finalGraspConfigId = graspConfigId;
    if (!finalGraspConfigId) {
      const defaultConfigId = await getDefaultGraspConfigId();
      if (defaultConfigId) {
        finalGraspConfigId = defaultConfigId;
      }
    }

    // Save to DynamoDB
    const now = Date.now();
    await ddb.send(
      new PutCommand({
        TableName: MEETINGS_METADATA_TABLE,
        Item: {
          meetingId: bot.id, // PK
          type: 'MEETING', // Fixed partition key for createdAt-index GSI (Issue #107)
          platform: 'recall',
          status: 'active',
          createdAt: now,
          meetingCode,
          graspConfigId: finalGraspConfigId || undefined, // Store DEFAULT or specified config ID
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
      graspConfigId: finalGraspConfigId || 'none',
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

      // Delete media with retry logic (Phase 1.2)
      // Note: deletion is handled asynchronously and does not block the response
      deleteMeetingMedia(result.Item.recallBot.botId);
    }

    // Update DynamoDB status
    const now = Date.now();
    // Set TTL to 7 days from now (Phase 1.1)
    const ttl = Math.floor(now / 1000) + (7 * 24 * 60 * 60);
    try {
      await ddb.send(
        new UpdateCommand({
          TableName: MEETINGS_METADATA_TABLE,
          Key: { meetingId },
          UpdateExpression: 'SET #status = :status, #endedAt = :endedAt, #ttl = :ttl',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#endedAt': 'endedAt',
            '#ttl': 'ttl',
          },
          ExpressionAttributeValues: {
            ':status': 'ended',
            ':endedAt': now,
            ':ttl': ttl,
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
 * GET /recall/meetings
 *
 * 全ての会議を取得（activeとendedの両方、最新順）
 *
 * Query Parameters:
 * - limit: 取得する会議の最大数（デフォルト: 50、最大: 100）
 * - nextToken: ページネーション用のトークン（base64エンコードされたLastEvaluatedKey）
 *
 * Response:
 * {
 *   meetings: Array<{
 *     meetingId: string;
 *     platform: string;
 *     status: string;
 *     createdAt: number;
 *     endedAt?: number;
 *     meetingCode?: string;
 *     recallBot?: { ... };
 *   }>,
 *   nextToken?: string; // 次のページがある場合のみ
 * }
 */
export const listHandler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    // Parse query parameters
    const limitParam = event.queryStringParameters?.limit;
    let limit = 50; // default

    if (limitParam) {
      const parsedLimit = parseInt(limitParam, 10);
      if (isNaN(parsedLimit) || parsedLimit < 1) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Invalid limit parameter' }),
        };
      }
      limit = Math.min(parsedLimit, 100);
    }

    const nextToken = event.queryStringParameters?.nextToken;

    // Decode nextToken if provided
    let exclusiveStartKey: Record<string, any> | undefined;
    if (nextToken) {
      try {
        exclusiveStartKey = JSON.parse(Buffer.from(nextToken, 'base64').toString('utf-8'));
      } catch (err) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Invalid nextToken' }),
        };
      }
    }

    // Query meetings using GSI (createdAt-index) for sorted results
    // Fixed partition key "MEETING" with createdAt sort key (Issue #107)
    const result = await ddb.send(
      new QueryCommand({
        TableName: MEETINGS_METADATA_TABLE,
        IndexName: 'createdAt-index',
        KeyConditionExpression: '#type = :type',
        ExpressionAttributeNames: {
          '#type': 'type',
        },
        ExpressionAttributeValues: {
          ':type': 'MEETING',
        },
        ScanIndexForward: false, // Descending order (newest first)
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
      })
    );

    // Results are already sorted by DynamoDB (descending createdAt)
    const meetings = result.Items || [];

    // Encode LastEvaluatedKey as nextToken if present
    const responseBody: any = { meetings };
    if (result.LastEvaluatedKey) {
      responseBody.nextToken = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(responseBody),
    };
  } catch (err: any) {
    console.error('Error listing meetings', {
      error: err?.message || err,
      stack: err?.stack,
    });

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to list meetings' }),
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
 * メディア削除処理（リトライ付き）
 *
 * Recall.aiのleaving processに時間がかかる可能性があるため、
 * 初回は10分待機してから削除を試行し、失敗した場合は10分間隔で2回リトライする。
 *
 * @param botId ボットID
 */
async function deleteMeetingMedia(botId: string): Promise<void> {
  const INITIAL_DELAY_MS = 10 * 60 * 1000; // 10分
  const RETRY_DELAY_MS = 10 * 60 * 1000;   // 10分
  const MAX_RETRIES = 2;

  // 非同期で実行（leaveHandlerをブロックしない）
  (async () => {
    try {
      // 初回10分待機
      console.log('Waiting 10 minutes before deleting Recall.ai media', { botId });
      await new Promise(resolve => setTimeout(resolve, INITIAL_DELAY_MS));

      // リトライロジック
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          await recallClient.deleteMedia(botId);
          console.log('Successfully deleted Recall.ai media', { botId, attempt });
          return; // 成功したら終了
        } catch (err: any) {
          const isLastAttempt = attempt === MAX_RETRIES;
          if (isLastAttempt) {
            // 最後の試行でも失敗したらログを出して終了
            console.error('Failed to delete Recall.ai media after all retries', {
              botId,
              totalAttempts: attempt + 1,
              error: err?.message || err,
            });
            return;
          }

          // リトライ前に待機
          console.warn('Failed to delete Recall.ai media, will retry', {
            botId,
            attempt,
            nextRetryIn: `${RETRY_DELAY_MS / 1000}s`,
            error: err?.message || err,
          });
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        }
      }
    } catch (err: any) {
      // 予期しないエラー
      console.error('Unexpected error in deleteMeetingMedia', {
        botId,
        error: err?.message || err,
        stack: err?.stack,
      });
    }
  })();
}

/**
 * DEFAULT Grasp設定のIDを取得
 * DynamoDBから name = "DEFAULT" の最新設定を取得する
 *
 * @returns DEFAULT設定のconfigId、または null（見つからない場合）
 */
async function getDefaultGraspConfigId(): Promise<string | null> {
  try {
    const result = await ddb.send(
      new ScanCommand({
        TableName: GRASP_CONFIGS_TABLE,
        FilterExpression: '#name = :defaultName',
        ExpressionAttributeNames: {
          '#name': 'name',
        },
        ExpressionAttributeValues: {
          ':defaultName': 'DEFAULT',
        },
      })
    );

    if (!result.Items || result.Items.length === 0) {
      console.log(JSON.stringify({
        type: 'graspConfig.noDefaultFound',
        message: 'No DEFAULT config found in DynamoDB',
        ts: Date.now(),
      }));
      return null;
    }

    // configId（タイムスタンプ含む）で降順ソートして最新を取得
    interface ConfigItem {
      configId: string;
    }

    const sortedConfigs = (result.Items as ConfigItem[]).sort((a, b) => {
      return b.configId.localeCompare(a.configId);
    });

    const latestConfig = sortedConfigs[0];

    console.log(JSON.stringify({
      type: 'graspConfig.defaultFound',
      configId: latestConfig.configId,
      ts: Date.now(),
    }));

    return latestConfig.configId;
  } catch (error) {
    console.error(JSON.stringify({
      type: 'graspConfig.defaultLookupError',
      error: (error as Error).message,
      ts: Date.now(),
    }));
    return null;
  }
}

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
