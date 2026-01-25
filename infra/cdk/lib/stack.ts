import { Stack, StackProps, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CfnApi, CfnIntegration, CfnRoute, CfnStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Duration } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

export class TimtamInfraStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // HTTP API は Web Distribution 作成後に定義して、CORS に CF ドメインを含める

    // === DynamoDB table for Media Pipeline ARNs ===
    // DEPRECATED: Will be removed once transcriptionStart/Stop are updated
    // Currently kept to avoid breaking existing deployments
    const mediaPipelineTable = new dynamodb.Table(this, 'MediaPipelineTable', {
      tableName: 'timtam-media-pipelines',
      partitionKey: { name: 'meetingId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: this.node.tryGetContext('keepTables') ? undefined : RemovalPolicy.DESTROY,
    });

    // === DynamoDB table for AI Messages (for web UI polling) ===
    const aiMessagesTable = new dynamodb.Table(this, 'AiMessagesTable', {
      tableName: 'timtam-ai-messages',
      partitionKey: { name: 'meetingId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: this.node.tryGetContext('keepTables') ? undefined : RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl', // Auto-delete old messages
    });

    // === DynamoDB table for meeting metadata (participants, start/end timestamps) ===
    // ADR 0015: Phase 2でGSI追加（Recall.ai統合）
    const meetingsMetadataTable = new dynamodb.Table(this, 'MeetingsMetadataTable', {
      tableName: 'timtam-meetings-metadata',
      partitionKey: { name: 'meetingId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: this.node.tryGetContext('keepTables') ? undefined : RemovalPolicy.DESTROY,
    });

    // GSI for Attendee access by meetingCode (ADR 0015)
    meetingsMetadataTable.addGlobalSecondaryIndex({
      indexName: 'meetingCode-index',
      partitionKey: { name: 'meetingCode', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // === DynamoDB table for Orchestrator Configuration ===
    const orchestratorConfigTable = new dynamodb.Table(this, 'OrchestratorConfigTable', {
      tableName: 'timtam-orchestrator-config',
      partitionKey: { name: 'configKey', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: this.node.tryGetContext('keepTables') ? undefined : RemovalPolicy.DESTROY,
    });

    // === DynamoDB table for Grasp Configuration Presets ===
    const graspConfigsTable = new dynamodb.Table(this, 'GraspConfigsTable', {
      tableName: 'timtam-grasp-configs',
      partitionKey: { name: 'configId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: this.node.tryGetContext('keepTables') ? undefined : RemovalPolicy.DESTROY,
    });

    // === SQS FIFO Queue for transcript streaming (ADR-0011) ===
    // Dead Letter Queue for failed messages
    const transcriptDlq = new sqs.Queue(this, 'TranscriptAsrDlq', {
      queueName: 'transcript-asr-dlq.fifo',
      fifo: true,
      retentionPeriod: Duration.days(14),
    });

    // Main FIFO queue with content-based deduplication
    const transcriptQueue = new sqs.Queue(this, 'TranscriptAsrQueue', {
      queueName: 'transcript-asr.fifo',
      fifo: true,
      contentBasedDeduplication: true,  // Prevents duplicate transcripts
      visibilityTimeout: Duration.seconds(30),
      retentionPeriod: Duration.days(1),
      deadLetterQueue: {
        queue: transcriptDlq,
        maxReceiveCount: 3,
      },
    });

    // === S3 bucket for Media Capture Pipeline audio ===
    // REMOVED: No longer needed with TranscriptEvent migration
    // Audio is no longer captured server-side via Media Capture Pipeline

    // === Meeting API Lambdas（作成のみ。ルートは後続のTODOで追加） ===
    const createMeetingFn = new NodejsFunction(this, 'CreateMeetingFn', {
      entry: '../../services/meeting-api/createMeeting.ts',
      timeout: Duration.seconds(15),
      runtime: lambda.Runtime.NODEJS_20_X,
    });

    const addAttendeeFn = new NodejsFunction(this, 'AddAttendeeFn', {
      entry: '../../services/meeting-api/attendees.ts',
      handler: 'add',
      timeout: Duration.seconds(15),
      runtime: lambda.Runtime.NODEJS_20_X,
    });

    const transcriptionStartFn = new NodejsFunction(this, 'TranscriptionStartFn', {
      entry: '../../services/meeting-api/transcriptionStart.ts',
      handler: 'start',
      timeout: Duration.seconds(15),
      runtime: lambda.Runtime.NODEJS_20_X,
      // No longer needs Media Pipeline environment variables
    });

    const transcriptionStopFn = new NodejsFunction(this, 'TranscriptionStopFn', {
      entry: '../../services/meeting-api/transcriptionStop.ts',
      handler: 'stop',
      timeout: Duration.seconds(15),
      runtime: lambda.Runtime.NODEJS_20_X,
      // No longer needs Media Pipeline environment variables
    });

    const upsertParticipantFn = new NodejsFunction(this, 'UpsertParticipantFn', {
      entry: '../../services/meeting-api/meetingMetadata.ts',
      handler: 'upsertParticipant',
      timeout: Duration.seconds(15),
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        MEETINGS_METADATA_TABLE: meetingsMetadataTable.tableName,
      },
    });

    const getParticipantsFn = new NodejsFunction(this, 'GetParticipantsFn', {
      entry: '../../services/meeting-api/meetingMetadata.ts',
      handler: 'getParticipants',
      timeout: Duration.seconds(15),
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        MEETINGS_METADATA_TABLE: meetingsMetadataTable.tableName,
      },
    });

    // New Lambda for receiving TranscriptEvent from browser
    const transcriptionEventsFn = new NodejsFunction(this, 'TranscriptionEventsFn', {
      entry: '../../services/meeting-api/transcriptionEvents.ts',
      timeout: Duration.seconds(10),
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        TRANSCRIPT_QUEUE_URL: transcriptQueue.queueUrl,  // ADR-0011
      },
    });

    // === Phase 2: Recall.ai Lambda Functions (ADR 0014, ADR 0015) ===
    // Recall.ai Webhook handler
    const recallWebhookFn = new NodejsFunction(this, 'RecallWebhookFn', {
      entry: '../../services/meeting-api/recallWebhook.ts',
      timeout: Duration.seconds(10),
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        TRANSCRIPT_QUEUE_URL: transcriptQueue.queueUrl,
        AI_MESSAGES_TABLE: aiMessagesTable.tableName,
        RECALL_API_KEY: process.env.RECALL_API_KEY || '', // TODO: Secrets Managerから取得
      },
    });

    // Recall.ai Meeting Join handler
    const recallJoinMeetingFn = new NodejsFunction(this, 'RecallJoinMeetingFn', {
      entry: '../../services/meeting-api/recallMeetings.ts',
      handler: 'joinHandler',
      timeout: Duration.seconds(15),
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        MEETINGS_METADATA_TABLE: meetingsMetadataTable.tableName,
        RECALL_API_KEY: process.env.RECALL_API_KEY || '', // TODO: Secrets Managerから取得
        RECALL_WEBHOOK_URL: process.env.RECALL_WEBHOOK_URL || '',
      },
    });

    // Recall.ai Meeting Get handler
    const recallGetMeetingFn = new NodejsFunction(this, 'RecallGetMeetingFn', {
      entry: '../../services/meeting-api/recallMeetings.ts',
      handler: 'getHandler',
      timeout: Duration.seconds(10),
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        MEETINGS_METADATA_TABLE: meetingsMetadataTable.tableName,
        RECALL_API_KEY: process.env.RECALL_API_KEY || '',
      },
    });

    // Recall.ai Meeting Leave handler
    const recallLeaveMeetingFn = new NodejsFunction(this, 'RecallLeaveMeetingFn', {
      entry: '../../services/meeting-api/recallMeetings.ts',
      handler: 'leaveHandler',
      timeout: Duration.seconds(15),
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        MEETINGS_METADATA_TABLE: meetingsMetadataTable.tableName,
        RECALL_API_KEY: process.env.RECALL_API_KEY || '',
      },
    });

    // Attendee: Get Meeting by Code handler
    const attendeeGetMeetingByCodeFn = new NodejsFunction(this, 'AttendeeGetMeetingByCodeFn', {
      entry: '../../services/meeting-api/recallMeetings.ts',
      handler: 'getMeetingByCodeHandler',
      timeout: Duration.seconds(10),
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        MEETINGS_METADATA_TABLE: meetingsMetadataTable.tableName,
      },
    });

    // 必要最小のIAM権限を付与（PoCのためワイルドカード。後でリソース制限へ）
    const meetingPolicies = new iam.PolicyStatement({
      actions: [
        'chime:CreateMeeting',
        'chime:CreateAttendee',
        'chime:DeleteMeeting',
        'chime:StartMeetingTranscription',
        'chime:StopMeetingTranscription',
        // 既存会議への参加時に会議情報を取得するため
        'chime:GetMeeting',
      ],
      resources: ['*'],
    });
    createMeetingFn.addToRolePolicy(meetingPolicies);
    addAttendeeFn.addToRolePolicy(meetingPolicies);
    transcriptionStartFn.addToRolePolicy(meetingPolicies);
    transcriptionStopFn.addToRolePolicy(meetingPolicies);

    // Grant SQS write permission to transcriptionEvents Lambda (ADR-0011)
    transcriptQueue.grantSendMessages(transcriptionEventsFn);

    // Phase 2: Grant permissions for Recall.ai Lambda functions
    transcriptQueue.grantSendMessages(recallWebhookFn);
    meetingsMetadataTable.grantReadWriteData(recallJoinMeetingFn);
    meetingsMetadataTable.grantReadData(recallGetMeetingFn);
    meetingsMetadataTable.grantReadWriteData(recallLeaveMeetingFn);
    meetingsMetadataTable.grantReadData(attendeeGetMeetingByCodeFn);

    // Ensure the Chime transcription service-linked role exists in this account
    // Required for Amazon Chime SDK live transcription with Amazon Transcribe
    new iam.CfnServiceLinkedRole(this, 'ChimeTranscriptionSlr', {
      awsServiceName: 'transcription.chime.amazonaws.com',
      description: 'Service-linked role for Amazon Chime transcription',
    });

    // === Audio Consumer Lambda ===
    // REMOVED: No longer needed with TranscriptEvent migration
    // Browser now sends transcription events directly to API

    // === Orchestrator & TTS Lambdas ===
    const orchestratorFn = new NodejsFunction(this, 'OrchestratorFn', {
      entry: '../../services/orchestrator/handler.ts',
      timeout: Duration.seconds(20),
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        // ADR0005: 既定のBedrockリージョンとモデルID（推論プロファイルARNを許容）
        BEDROCK_REGION: 'ap-northeast-1',
        BEDROCK_MODEL_ID:
          'arn:aws:bedrock:ap-northeast-1:030046728177:inference-profile/global.anthropic.claude-haiku-4-5-20251001-v1:0',
      },
    });
    orchestratorFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
      ],
      resources: ['*'], // TODO: 後でモデルARNに絞る
    }));

    const ttsFn = new NodejsFunction(this, 'TtsFn', {
      entry: '../../services/tts/handler.ts',
      timeout: Duration.seconds(20),
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        // ADR0005: 既定のPolly音声
        TTS_DEFAULT_VOICE: 'Mizuki',
      },
    });
    ttsFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['polly:SynthesizeSpeech'],
      resources: ['*'],
    }));

    // === Grasp Config API Lambdas ===
    const getGraspConfigsFn = new NodejsFunction(this, 'GetGraspConfigsFn', {
      entry: '../../services/grasp-config/getConfigs.ts',
      timeout: Duration.seconds(10),
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        GRASP_CONFIGS_TABLE: graspConfigsTable.tableName,
      },
    });
    graspConfigsTable.grantReadData(getGraspConfigsFn);

    const getCurrentGraspConfigFn = new NodejsFunction(this, 'GetCurrentGraspConfigFn', {
      entry: '../../services/grasp-config/getCurrentConfig.ts',
      timeout: Duration.seconds(10),
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        CONFIG_TABLE_NAME: orchestratorConfigTable.tableName,
      },
    });
    orchestratorConfigTable.grantReadData(getCurrentGraspConfigFn);

    const updateGraspConfigFn = new NodejsFunction(this, 'UpdateGraspConfigFn', {
      entry: '../../services/grasp-config/updateConfig.ts',
      timeout: Duration.seconds(10),
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        CONFIG_TABLE_NAME: orchestratorConfigTable.tableName,
        CONTROL_SQS_URL: '', // Will be set after controlQueue is created
      },
      bundling: {
        nodeModules: ['@aws-sdk/client-sqs', 'js-yaml'],
        externalModules: ['aws-sdk'],
        target: 'node20',
        platform: 'node',
      },
    });
    orchestratorConfigTable.grantWriteData(updateGraspConfigFn);

    const saveGraspPresetFn = new NodejsFunction(this, 'SaveGraspPresetFn', {
      entry: '../../services/grasp-config/savePreset.ts',
      timeout: Duration.seconds(10),
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        GRASP_CONFIGS_TABLE: graspConfigsTable.tableName,
      },
      bundling: {
        nodeModules: ['js-yaml'],
        externalModules: ['aws-sdk'],
        target: 'node20',
        platform: 'node',
      },
    });
    graspConfigsTable.grantWriteData(saveGraspPresetFn);

    // Save Grasp Config with Auto-Generated ID (POST /grasp/configs)
    const saveGraspConfigFn = new NodejsFunction(this, 'SaveGraspConfigFn', {
      entry: '../../services/grasp-config/saveConfig.ts',
      timeout: Duration.seconds(10),
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        GRASP_CONFIGS_TABLE: graspConfigsTable.tableName,
      },
      bundling: {
        nodeModules: ['js-yaml'],
        externalModules: ['aws-sdk'],
        target: 'node20',
        platform: 'node',
      },
    });
    graspConfigsTable.grantWriteData(saveGraspConfigFn);

    // Get Specific Grasp Config (GET /grasp/configs/{configId})
    const getGraspConfigByIdFn = new NodejsFunction(this, 'GetGraspConfigByIdFn', {
      entry: '../../services/grasp-config/getConfig.ts',
      timeout: Duration.seconds(10),
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        GRASP_CONFIGS_TABLE: graspConfigsTable.tableName,
      },
    });
    graspConfigsTable.grantReadData(getGraspConfigByIdFn);

    // Apply Grasp Config to Meeting (POST /meetings/{meetingId}/grasp-config)
    const applyGraspConfigToMeetingFn = new NodejsFunction(this, 'ApplyGraspConfigToMeetingFn', {
      entry: '../../services/grasp-config/applyConfigToMeeting.ts',
      timeout: Duration.seconds(10),
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        GRASP_CONFIGS_TABLE: graspConfigsTable.tableName,
        CONTROL_SQS_URL: '', // Will be set after controlQueue is created
      },
      bundling: {
        nodeModules: ['@aws-sdk/client-sqs', 'js-yaml'],
        externalModules: ['aws-sdk'],
        target: 'node20',
        platform: 'node',
      },
    });
    graspConfigsTable.grantReadData(applyGraspConfigToMeetingFn);

    // === Admin API Lambdas ===
    // Read ADMIN_PASSWORD from context (passed via --context or cdk.json)
    const adminPassword = this.node.tryGetContext('adminPassword') || process.env.ADMIN_PASSWORD || '';
    if (!adminPassword) {
      console.warn('WARNING: ADMIN_PASSWORD not set. Admin API will not work properly.');
    }

    const adminCloseFn = new NodejsFunction(this, 'AdminCloseFn', {
      entry: '../../services/admin-api/close.ts',
      timeout: Duration.seconds(60),
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        ADMIN_PASSWORD: adminPassword,
      },
      bundling: {
        nodeModules: [
          '@aws-sdk/client-lambda',
          '@aws-sdk/client-ecs',
          '@aws-sdk/client-cloudfront',
          '@aws-sdk/client-cloudformation',
        ],
        externalModules: ['aws-sdk'],
        target: 'node20',
        platform: 'node',
      },
    });

    const adminOpenFn = new NodejsFunction(this, 'AdminOpenFn', {
      entry: '../../services/admin-api/open.ts',
      timeout: Duration.seconds(60),
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        ADMIN_PASSWORD: adminPassword,
      },
      bundling: {
        nodeModules: [
          '@aws-sdk/client-lambda',
          '@aws-sdk/client-ecs',
          '@aws-sdk/client-cloudfront',
          '@aws-sdk/client-cloudformation',
        ],
        externalModules: ['aws-sdk'],
        target: 'node20',
        platform: 'node',
      },
    });

    // Grant permissions to admin Lambdas
    // CloudFormationを使ってリソース情報を取得するため、ListFunctionsは不要
    adminCloseFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['lambda:PutFunctionConcurrency'],
      resources: [`arn:aws:lambda:${this.region}:${this.account}:function:TimtamInfraStack-*`],
    }));
    // Note: ListServicesはクラスターレベルのアクションのため*を使用
    adminCloseFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ecs:ListServices'],
      resources: ['*'],
    }));
    adminCloseFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cloudformation:DescribeStackResources', 'cloudformation:DescribeStacks'],
      resources: [`arn:aws:cloudformation:${this.region}:${this.account}:stack/TimtamInfraStack/*`],
    }));

    adminOpenFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['lambda:DeleteFunctionConcurrency'],
      resources: [`arn:aws:lambda:${this.region}:${this.account}:function:TimtamInfraStack-*`],
    }));
    adminOpenFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ecs:ListServices'],
      resources: ['*'],
    }));
    adminOpenFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cloudformation:DescribeStackResources', 'cloudformation:DescribeStacks'],
      resources: [`arn:aws:cloudformation:${this.region}:${this.account}:stack/TimtamInfraStack/*`],
    }));

    // === Orchestrator Control (SQS + Lambda trigger from UI) ===
    const controlQueue = new sqs.Queue(this, 'OrchestratorControlQueue', {
      visibilityTimeout: Duration.seconds(10),
      retentionPeriod: Duration.days(1),
    });

    // Update updateGraspConfigFn with SQS URL and grant permissions
    updateGraspConfigFn.addEnvironment('CONTROL_SQS_URL', controlQueue.queueUrl);
    controlQueue.grantSendMessages(updateGraspConfigFn);

    // Update applyGraspConfigToMeetingFn with SQS URL and grant permissions
    applyGraspConfigToMeetingFn.addEnvironment('CONTROL_SQS_URL', controlQueue.queueUrl);
    controlQueue.grantSendMessages(applyGraspConfigToMeetingFn);

    const startMeetingFn = new NodejsFunction(this, 'StartMeetingOrchestratorFn', {
      entry: '../../services/orchestrator/startMeeting.ts',
      timeout: Duration.seconds(10),
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        CONTROL_SQS_URL: controlQueue.queueUrl,
      },
      bundling: {
        nodeModules: ['@aws-sdk/client-sqs'],
        externalModules: ['aws-sdk'],
        target: 'node20',
        platform: 'node',
      },
    });
    controlQueue.grantSendMessages(startMeetingFn);

    // === Web hosting: S3 bucket (private; to be served via CloudFront) ===
    const siteBucket = new s3.Bucket(this, 'WebSiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
    });

    // CloudFront distribution (SPA fallback) with Origin Access Identity
    // ADR 0015: Multiple UIs with different URL paths
    const webOai = new cloudfront.OriginAccessIdentity(this, 'WebOAI');
    siteBucket.grantRead(webOai);

    const s3Origin = new origins.S3Origin(siteBucket, { originAccessIdentity: webOai });

    const webDistribution = new cloudfront.Distribution(this, 'WebDistribution', {
      defaultRootObject: 'index.html',
      // Default behavior: Facilitator UI (/)
      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        functionAssociations: [{
          function: new cloudfront.Function(this, 'FacilitatorRewrite', {
            code: cloudfront.FunctionCode.fromInline(`
              function handler(event) {
                var request = event.request;
                var uri = request.uri;

                // Special handling for /experiment (without trailing slash)
                // Rewrite to Chime WebUI
                if (uri === '/experiment') {
                  request.uri = '/timtam-web/index.html';
                  return request;
                }

                // Facilitator UI (root path)
                // If requesting /, serve facilitator/index.html
                if (uri === '/' || uri === '') {
                  request.uri = '/facilitator/index.html';
                }
                // If requesting /something without extension, try to serve facilitator/something.html
                // If that file doesn't exist (404), error responses will fallback to facilitator/index.html for SPA routing
                else if (!uri.includes('.') && !uri.startsWith('/experiment') && !uri.includes('/attendee')) {
                  request.uri = '/facilitator' + uri + '.html';
                }
                // If requesting /_next/... (Next.js assets), prepend /facilitator
                else if (uri.startsWith('/_next/')) {
                  request.uri = '/facilitator' + uri;
                }

                return request;
              }
            `),
          }),
          eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
        }],
      },
      additionalBehaviors: {
        // Experimental Chime WebUI (/experiment/*)
        '/experiment/*': {
          origin: s3Origin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          functionAssociations: [{
            function: new cloudfront.Function(this, 'ExperimentRewrite', {
              code: cloudfront.FunctionCode.fromInline(`
                function handler(event) {
                  var request = event.request;
                  var uri = request.uri;

                  // Remove /experiment prefix and serve from timtam-web/
                  if (uri.startsWith('/experiment')) {
                    uri = uri.substring(11); // Remove '/experiment'
                    if (uri === '' || uri === '/') {
                      request.uri = '/timtam-web/index.html';
                    } else {
                      request.uri = '/timtam-web' + uri;
                    }
                  }

                  return request;
                }
              `),
            }),
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          }],
        },
      },
      errorResponses: [
        // Facilitator UI SPA fallback
        { httpStatus: 403, responsePagePath: '/facilitator/index.html', responseHttpStatus: 200 },
        { httpStatus: 404, responsePagePath: '/facilitator/index.html', responseHttpStatus: 200 },
      ],
    });

    // === API Gateway HTTP API: create after web distribution so we can include CF domain in CORS ===
    const httpApi = new CfnApi(this, 'HttpApi', {
      name: 'timtam-http-api',
      protocolType: 'HTTP',
      corsConfiguration: {
        allowOrigins: [
          'http://localhost:5173',
          'http://127.0.0.1:5173',
          `https://${webDistribution.distributionDomainName}`,
        ],
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowHeaders: ['*'],
        exposeHeaders: [],
        maxAge: 3600,
      },
    });
    const stage = new CfnStage(this, 'HttpApiStage', {
      apiId: httpApi.ref,
      stageName: '$default',
      autoDeploy: true,
    });

    // (CORS は上で CF ドメインを含めて定義済み)

    // Helper to build Lambda proxy integration URI
    const lambdaIntegrationUri = (fn: lambda.IFunction) =>
      `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${fn.functionArn}/invocations`;

    // CreateMeeting integration + route
    const createMeetingInt = new CfnIntegration(this, 'CreateMeetingIntegration', {
      apiId: httpApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: lambdaIntegrationUri(createMeetingFn),
      payloadFormatVersion: '2.0',
      integrationMethod: 'POST',
    });
    const createMeetingRoute = new CfnRoute(this, 'CreateMeetingRoute', {
      apiId: httpApi.ref,
      routeKey: 'POST /meetings',
      target: `integrations/${createMeetingInt.ref}`,
    });
    createMeetingRoute.addDependency(createMeetingInt);

    // AddAttendee integration + route
    const addAttendeeInt = new CfnIntegration(this, 'AddAttendeeIntegration', {
      apiId: httpApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: lambdaIntegrationUri(addAttendeeFn),
      payloadFormatVersion: '2.0',
      integrationMethod: 'POST',
    });
    const addAttendeeRoute = new CfnRoute(this, 'AddAttendeeRoute', {
      apiId: httpApi.ref,
      routeKey: 'POST /attendees',
      target: `integrations/${addAttendeeInt.ref}`,
    });
    addAttendeeRoute.addDependency(addAttendeeInt);

    // Transcription start integration + route
    const transcriptionStartInt = new CfnIntegration(this, 'TranscriptionStartIntegration', {
      apiId: httpApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: lambdaIntegrationUri(transcriptionStartFn),
      payloadFormatVersion: '2.0',
      integrationMethod: 'POST',
    });
    const transcriptionStartRoute = new CfnRoute(this, 'TranscriptionStartRoute', {
      apiId: httpApi.ref,
      routeKey: 'POST /meetings/{meetingId}/transcription/start',
      target: `integrations/${transcriptionStartInt.ref}`,
    });
    transcriptionStartRoute.addDependency(transcriptionStartInt);

    // Transcription stop integration + route
    const transcriptionStopInt = new CfnIntegration(this, 'TranscriptionStopIntegration', {
      apiId: httpApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: lambdaIntegrationUri(transcriptionStopFn),
      payloadFormatVersion: '2.0',
      integrationMethod: 'POST',
    });
    const transcriptionStopRoute = new CfnRoute(this, 'TranscriptionStopRoute', {
      apiId: httpApi.ref,
      routeKey: 'POST /meetings/{meetingId}/transcription/stop',
      target: `integrations/${transcriptionStopInt.ref}`,
    });
    transcriptionStopRoute.addDependency(transcriptionStopInt);

    // Meeting metadata routes (participants upsert/list, end meeting)
    const meetingMetadataInt = new CfnIntegration(this, 'MeetingMetadataIntegration', {
      apiId: httpApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: lambdaIntegrationUri(upsertParticipantFn),
      payloadFormatVersion: '2.0',
      integrationMethod: 'POST',
    });

    const upsertParticipantRoute = new CfnRoute(this, 'UpsertParticipantRoute', {
      apiId: httpApi.ref,
      routeKey: 'POST /meetings/{meetingId}/participants',
      target: `integrations/${meetingMetadataInt.ref}`,
    });
    upsertParticipantRoute.addDependency(meetingMetadataInt);

    const getParticipantsInt = new CfnIntegration(this, 'GetParticipantsIntegration', {
      apiId: httpApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: lambdaIntegrationUri(getParticipantsFn),
      payloadFormatVersion: '2.0',
      integrationMethod: 'POST',
    });

    const getParticipantsRoute = new CfnRoute(this, 'GetParticipantsRoute', {
      apiId: httpApi.ref,
      routeKey: 'GET /meetings/{meetingId}/participants',
      target: `integrations/${getParticipantsInt.ref}`,
    });
    getParticipantsRoute.addDependency(getParticipantsInt);

    // Transcription events integration + route (NEW: for browser TranscriptEvent)
    const transcriptionEventsInt = new CfnIntegration(this, 'TranscriptionEventsIntegration', {
      apiId: httpApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: lambdaIntegrationUri(transcriptionEventsFn),
      payloadFormatVersion: '2.0',
      integrationMethod: 'POST',
    });
    const transcriptionEventsRoute = new CfnRoute(this, 'TranscriptionEventsRoute', {
      apiId: httpApi.ref,
      routeKey: 'POST /meetings/{meetingId}/transcription/events',
      target: `integrations/${transcriptionEventsInt.ref}`,
    });
    transcriptionEventsRoute.addDependency(transcriptionEventsInt);

    // === Phase 2: Recall.ai API Routes (ADR 0014, ADR 0015) ===
    // Recall.ai Webhook
    const recallWebhookInt = new CfnIntegration(this, 'RecallWebhookIntegration', {
      apiId: httpApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: lambdaIntegrationUri(recallWebhookFn),
      payloadFormatVersion: '2.0',
      integrationMethod: 'POST',
    });
    const recallWebhookRoute = new CfnRoute(this, 'RecallWebhookRoute', {
      apiId: httpApi.ref,
      routeKey: 'POST /recall/webhook',
      target: `integrations/${recallWebhookInt.ref}`,
    });
    recallWebhookRoute.addDependency(recallWebhookInt);

    // Recall.ai Join Meeting
    const recallJoinMeetingInt = new CfnIntegration(this, 'RecallJoinMeetingIntegration', {
      apiId: httpApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: lambdaIntegrationUri(recallJoinMeetingFn),
      payloadFormatVersion: '2.0',
      integrationMethod: 'POST',
    });
    const recallJoinMeetingRoute = new CfnRoute(this, 'RecallJoinMeetingRoute', {
      apiId: httpApi.ref,
      routeKey: 'POST /recall/meetings/join',
      target: `integrations/${recallJoinMeetingInt.ref}`,
    });
    recallJoinMeetingRoute.addDependency(recallJoinMeetingInt);

    // Recall.ai Get Meeting
    const recallGetMeetingInt = new CfnIntegration(this, 'RecallGetMeetingIntegration', {
      apiId: httpApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: lambdaIntegrationUri(recallGetMeetingFn),
      payloadFormatVersion: '2.0',
      integrationMethod: 'POST',
    });
    const recallGetMeetingRoute = new CfnRoute(this, 'RecallGetMeetingRoute', {
      apiId: httpApi.ref,
      routeKey: 'GET /recall/meetings/{meetingId}',
      target: `integrations/${recallGetMeetingInt.ref}`,
    });
    recallGetMeetingRoute.addDependency(recallGetMeetingInt);

    // Recall.ai Leave Meeting
    const recallLeaveMeetingInt = new CfnIntegration(this, 'RecallLeaveMeetingIntegration', {
      apiId: httpApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: lambdaIntegrationUri(recallLeaveMeetingFn),
      payloadFormatVersion: '2.0',
      integrationMethod: 'POST',
    });
    const recallLeaveMeetingRoute = new CfnRoute(this, 'RecallLeaveMeetingRoute', {
      apiId: httpApi.ref,
      routeKey: 'DELETE /recall/meetings/{meetingId}',
      target: `integrations/${recallLeaveMeetingInt.ref}`,
    });
    recallLeaveMeetingRoute.addDependency(recallLeaveMeetingInt);

    // Attendee: Get Meeting by Code
    const attendeeGetMeetingByCodeInt = new CfnIntegration(this, 'AttendeeGetMeetingByCodeIntegration', {
      apiId: httpApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: lambdaIntegrationUri(attendeeGetMeetingByCodeFn),
      payloadFormatVersion: '2.0',
      integrationMethod: 'POST',
    });
    const attendeeGetMeetingByCodeRoute = new CfnRoute(this, 'AttendeeGetMeetingByCodeRoute', {
      apiId: httpApi.ref,
      routeKey: 'GET /attendee/meetings/{code}',
      target: `integrations/${attendeeGetMeetingByCodeInt.ref}`,
    });
    attendeeGetMeetingByCodeRoute.addDependency(attendeeGetMeetingByCodeInt);

    // Allow API Gateway to invoke these Lambdas
    const sourceArn = `arn:aws:execute-api:${this.region}:${this.account}:${httpApi.ref}/*/*/*`;
    [
      createMeetingFn,
      addAttendeeFn,
      transcriptionStartFn,
      transcriptionStopFn,
      transcriptionEventsFn,
      upsertParticipantFn,
      getParticipantsFn,
      // Phase 2: Recall.ai Lambda functions
      recallWebhookFn,
      recallJoinMeetingFn,
      recallGetMeetingFn,
      recallLeaveMeetingFn,
      attendeeGetMeetingByCodeFn,
    ].forEach((fn, i) => {
      fn.addPermission(`InvokeByHttpApi${i}`, {
        principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
        sourceArn,
        action: 'lambda:InvokeFunction',
      });
    });

    // Orchestrator integration + route
    const orchestratorInt = new CfnIntegration(this, 'OrchestratorIntegration', {
      apiId: httpApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: lambdaIntegrationUri(orchestratorFn),
      payloadFormatVersion: '2.0',
      integrationMethod: 'POST',
    });
    const orchestratorRoute = new CfnRoute(this, 'OrchestratorRoute', {
      apiId: httpApi.ref,
      routeKey: 'POST /events/transcript',
      target: `integrations/${orchestratorInt.ref}`,
    });
    orchestratorRoute.addDependency(orchestratorInt);
    orchestratorFn.addPermission('InvokeByHttpApiOrchestrator', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn,
      action: 'lambda:InvokeFunction',
    });

    // Start Orchestrator for a meeting (UI -> Lambda -> SQS)
    const startMeetingInt = new CfnIntegration(this, 'StartMeetingOrchestratorIntegration', {
      apiId: httpApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: lambdaIntegrationUri(startMeetingFn),
      payloadFormatVersion: '2.0',
      integrationMethod: 'POST',
    });
    const startMeetingRoute = new CfnRoute(this, 'StartMeetingOrchestratorRoute', {
      apiId: httpApi.ref,
      routeKey: 'POST /meetings/{meetingId}/orchestrator/start',
      target: `integrations/${startMeetingInt.ref}`,
    });
    startMeetingRoute.addDependency(startMeetingInt);
    startMeetingFn.addPermission('InvokeByHttpApiStartMeeting', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn,
      action: 'lambda:InvokeFunction',
    });

    // TTS integration + route
    const ttsInt = new CfnIntegration(this, 'TtsIntegration', {
      apiId: httpApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: lambdaIntegrationUri(ttsFn),
      payloadFormatVersion: '2.0',
      integrationMethod: 'POST',
    });
    const ttsRoute = new CfnRoute(this, 'TtsRoute', {
      apiId: httpApi.ref,
      routeKey: 'POST /tts',
      target: `integrations/${ttsInt.ref}`,
    });
    ttsRoute.addDependency(ttsInt);
    ttsFn.addPermission('InvokeByHttpApiTts', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn,
      action: 'lambda:InvokeFunction',
    });

    // === Config & Health Lambdas (GET) ===
    const apiBaseUrl = `https://${httpApi.ref}.execute-api.${this.region}.amazonaws.com`;

    const configFn = new NodejsFunction(this, 'ConfigFn', {
      entry: '../../services/config/handler.ts',
      timeout: Duration.seconds(10),
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        API_BASE_URL: apiBaseUrl,
        DEFAULT_BEDROCK_REGION: 'ap-northeast-1',
        DEFAULT_MODEL_ID:
          'arn:aws:bedrock:ap-northeast-1:030046728177:inference-profile/global.anthropic.claude-haiku-4-5-20251001-v1:0',
        TTS_DEFAULT_VOICE: 'Mizuki',
      },
    });

    const healthFn = new NodejsFunction(this, 'HealthFn', {
      entry: '../../services/health/handler.ts',
      timeout: Duration.seconds(5),
      runtime: lambda.Runtime.NODEJS_20_X,
    });

    const aiMessagesFn = new NodejsFunction(this, 'AiMessagesFn', {
      entry: '../../services/ai-messages/handler.ts',
      handler: 'getMessages',
      timeout: Duration.seconds(10),
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        AI_MESSAGES_TABLE: aiMessagesTable.tableName,
      },
    });
    aiMessagesTable.grantReadData(aiMessagesFn);
    meetingsMetadataTable.grantReadWriteData(upsertParticipantFn);
    meetingsMetadataTable.grantReadData(getParticipantsFn);

    // Config integration + route (GET /config)
    const configInt = new CfnIntegration(this, 'ConfigIntegration', {
      apiId: httpApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: lambdaIntegrationUri(configFn),
      payloadFormatVersion: '2.0',
      integrationMethod: 'POST',
    });
    const configRoute = new CfnRoute(this, 'ConfigRoute', {
      apiId: httpApi.ref,
      routeKey: 'GET /config',
      target: `integrations/${configInt.ref}`,
    });
    configRoute.addDependency(configInt);
    configFn.addPermission('InvokeByHttpApiConfig', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn,
      action: 'lambda:InvokeFunction',
    });

    // Health integration + route (GET /health)
    const healthInt = new CfnIntegration(this, 'HealthIntegration', {
      apiId: httpApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: lambdaIntegrationUri(healthFn),
      payloadFormatVersion: '2.0',
      integrationMethod: 'POST',
    });
    const healthRoute = new CfnRoute(this, 'HealthRoute', {
      apiId: httpApi.ref,
      routeKey: 'GET /health',
      target: `integrations/${healthInt.ref}`,
    });
    healthRoute.addDependency(healthInt);
    healthFn.addPermission('InvokeByHttpApiHealth', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn,
      action: 'lambda:InvokeFunction',
    });

    // AI Messages integration + route (GET /meetings/{meetingId}/messages)
    const aiMessagesInt = new CfnIntegration(this, 'AiMessagesIntegration', {
      apiId: httpApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: lambdaIntegrationUri(aiMessagesFn),
      payloadFormatVersion: '2.0',
      integrationMethod: 'POST',
    });
    const aiMessagesRoute = new CfnRoute(this, 'AiMessagesRoute', {
      apiId: httpApi.ref,
      routeKey: 'GET /meetings/{meetingId}/messages',
      target: `integrations/${aiMessagesInt.ref}`,
    });
    aiMessagesRoute.addDependency(aiMessagesInt);
    aiMessagesFn.addPermission('InvokeByHttpApiAiMessages', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn,
      action: 'lambda:InvokeFunction',
    });

    // === Grasp Config API Routes ===

    // Get Grasp Configs (GET /grasp/configs)
    const getGraspConfigsInt = new CfnIntegration(this, 'GetGraspConfigsIntegration', {
      apiId: httpApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: lambdaIntegrationUri(getGraspConfigsFn),
      payloadFormatVersion: '2.0',
      integrationMethod: 'POST',
    });
    const getGraspConfigsRoute = new CfnRoute(this, 'GetGraspConfigsRoute', {
      apiId: httpApi.ref,
      routeKey: 'GET /grasp/configs',
      target: `integrations/${getGraspConfigsInt.ref}`,
    });
    getGraspConfigsRoute.addDependency(getGraspConfigsInt);
    getGraspConfigsFn.addPermission('InvokeByHttpApiGetGraspConfigs', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn,
      action: 'lambda:InvokeFunction',
    });

    // Get Current Grasp Config (GET /grasp/config/current)
    const getCurrentGraspConfigInt = new CfnIntegration(this, 'GetCurrentGraspConfigIntegration', {
      apiId: httpApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: lambdaIntegrationUri(getCurrentGraspConfigFn),
      payloadFormatVersion: '2.0',
      integrationMethod: 'POST',
    });
    const getCurrentGraspConfigRoute = new CfnRoute(this, 'GetCurrentGraspConfigRoute', {
      apiId: httpApi.ref,
      routeKey: 'GET /grasp/config/current',
      target: `integrations/${getCurrentGraspConfigInt.ref}`,
    });
    getCurrentGraspConfigRoute.addDependency(getCurrentGraspConfigInt);
    getCurrentGraspConfigFn.addPermission('InvokeByHttpApiGetCurrentGraspConfig', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn,
      action: 'lambda:InvokeFunction',
    });

    // Update Grasp Config (PUT /grasp/config)
    const updateGraspConfigInt = new CfnIntegration(this, 'UpdateGraspConfigIntegration', {
      apiId: httpApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: lambdaIntegrationUri(updateGraspConfigFn),
      payloadFormatVersion: '2.0',
      integrationMethod: 'POST',
    });
    const updateGraspConfigRoute = new CfnRoute(this, 'UpdateGraspConfigRoute', {
      apiId: httpApi.ref,
      routeKey: 'PUT /grasp/config',
      target: `integrations/${updateGraspConfigInt.ref}`,
    });
    updateGraspConfigRoute.addDependency(updateGraspConfigInt);
    updateGraspConfigFn.addPermission('InvokeByHttpApiUpdateGraspConfig', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn,
      action: 'lambda:InvokeFunction',
    });

    // Save Grasp Preset (POST /grasp/presets)
    const saveGraspPresetInt = new CfnIntegration(this, 'SaveGraspPresetIntegration', {
      apiId: httpApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: lambdaIntegrationUri(saveGraspPresetFn),
      payloadFormatVersion: '2.0',
      integrationMethod: 'POST',
    });
    const saveGraspPresetRoute = new CfnRoute(this, 'SaveGraspPresetRoute', {
      apiId: httpApi.ref,
      routeKey: 'POST /grasp/presets',
      target: `integrations/${saveGraspPresetInt.ref}`,
    });
    saveGraspPresetRoute.addDependency(saveGraspPresetInt);
    saveGraspPresetFn.addPermission('InvokeByHttpApiSaveGraspPreset', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn,
      action: 'lambda:InvokeFunction',
    });

    // Save Grasp Config (POST /grasp/configs)
    const saveGraspConfigInt = new CfnIntegration(this, 'SaveGraspConfigIntegration', {
      apiId: httpApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: lambdaIntegrationUri(saveGraspConfigFn),
      payloadFormatVersion: '2.0',
      integrationMethod: 'POST',
    });
    const saveGraspConfigRoute = new CfnRoute(this, 'SaveGraspConfigRoute', {
      apiId: httpApi.ref,
      routeKey: 'POST /grasp/configs',
      target: `integrations/${saveGraspConfigInt.ref}`,
    });
    saveGraspConfigRoute.addDependency(saveGraspConfigInt);
    saveGraspConfigFn.addPermission('InvokeByHttpApiSaveGraspConfig', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn,
      action: 'lambda:InvokeFunction',
    });

    // Get Grasp Config by ID (GET /grasp/configs/{configId})
    const getGraspConfigByIdInt = new CfnIntegration(this, 'GetGraspConfigByIdIntegration', {
      apiId: httpApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: lambdaIntegrationUri(getGraspConfigByIdFn),
      payloadFormatVersion: '2.0',
      integrationMethod: 'POST',
    });
    const getGraspConfigByIdRoute = new CfnRoute(this, 'GetGraspConfigByIdRoute', {
      apiId: httpApi.ref,
      routeKey: 'GET /grasp/configs/{configId}',
      target: `integrations/${getGraspConfigByIdInt.ref}`,
    });
    getGraspConfigByIdRoute.addDependency(getGraspConfigByIdInt);
    getGraspConfigByIdFn.addPermission('InvokeByHttpApiGetGraspConfigById', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn,
      action: 'lambda:InvokeFunction',
    });

    // Apply Grasp Config to Meeting (POST /meetings/{meetingId}/grasp-config)
    const applyGraspConfigToMeetingInt = new CfnIntegration(this, 'ApplyGraspConfigToMeetingIntegration', {
      apiId: httpApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: lambdaIntegrationUri(applyGraspConfigToMeetingFn),
      payloadFormatVersion: '2.0',
      integrationMethod: 'POST',
    });
    const applyGraspConfigToMeetingRoute = new CfnRoute(this, 'ApplyGraspConfigToMeetingRoute', {
      apiId: httpApi.ref,
      routeKey: 'POST /meetings/{meetingId}/grasp-config',
      target: `integrations/${applyGraspConfigToMeetingInt.ref}`,
    });
    applyGraspConfigToMeetingRoute.addDependency(applyGraspConfigToMeetingInt);
    applyGraspConfigToMeetingFn.addPermission('InvokeByHttpApiApplyGraspConfigToMeeting', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn,
      action: 'lambda:InvokeFunction',
    });

    // Admin API routes
    const adminCloseInt = new CfnIntegration(this, 'AdminCloseIntegration', {
      apiId: httpApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: lambdaIntegrationUri(adminCloseFn),
      payloadFormatVersion: '2.0',
      integrationMethod: 'POST',
    });
    const adminCloseRoute = new CfnRoute(this, 'AdminCloseRoute', {
      apiId: httpApi.ref,
      routeKey: 'GET /admin/close/{password}',
      target: `integrations/${adminCloseInt.ref}`,
    });
    adminCloseRoute.addDependency(adminCloseInt);
    adminCloseFn.addPermission('InvokeByHttpApiAdminClose', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn,
      action: 'lambda:InvokeFunction',
    });

    const adminOpenInt = new CfnIntegration(this, 'AdminOpenIntegration', {
      apiId: httpApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: lambdaIntegrationUri(adminOpenFn),
      payloadFormatVersion: '2.0',
      integrationMethod: 'POST',
    });
    const adminOpenRoute = new CfnRoute(this, 'AdminOpenRoute', {
      apiId: httpApi.ref,
      routeKey: 'GET /admin/open/{password}',
      target: `integrations/${adminOpenInt.ref}`,
    });
    adminOpenRoute.addDependency(adminOpenInt);
    adminOpenFn.addPermission('InvokeByHttpApiAdminOpen', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn,
      action: 'lambda:InvokeFunction',
    });

    // === ECS Fargate Orchestrator (always-on service) ===
    // Use default VPC lookup (original design); relies on CDK env/account/region being set
    const vpc = ec2.Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true });
    const cluster = new ecs.Cluster(this, 'OrchestratorCluster', { vpc });

    const taskRole = new iam.Role(this, 'OrchestratorTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    // Permissions: Bedrock invoke, CloudWatch metrics, SQS consume, DynamoDB write
    taskRole.addToPolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: ['*'],
    }));
    taskRole.addToPolicy(new iam.PolicyStatement({
      actions: ['cloudwatch:PutMetricData'],
      resources: ['*'],
    }));
    controlQueue.grantConsumeMessages(taskRole);
    transcriptQueue.grantConsumeMessages(taskRole);  // ADR-0011: Grant SQS consume permission
    aiMessagesTable.grantWriteData(taskRole);
    orchestratorConfigTable.grantReadData(taskRole);

    const taskDef = new ecs.FargateTaskDefinition(this, 'OrchestratorTaskDef', {
      cpu: 512,
      memoryLimitMiB: 1024,
      taskRole,
    });
    const logGroup = new logs.LogGroup(this, 'OrchestratorLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
    });
    const container = taskDef.addContainer('OrchestratorContainer', {
      image: ecs.ContainerImage.fromAsset('../..', {  // モノレポルート
        file: 'services/orchestrator/Dockerfile',
      }),
      logging: ecs.LogDriver.awsLogs({ logGroup, streamPrefix: 'orchestrator' }),
      environment: {
        TRANSCRIPT_QUEUE_URL: transcriptQueue.queueUrl,  // ADR-0011: SQS FIFO queue
        BEDROCK_REGION: 'ap-northeast-1',
        BEDROCK_MODEL_ID: 'arn:aws:bedrock:ap-northeast-1:030046728177:inference-profile/global.anthropic.claude-haiku-4-5-20251001-v1:0',
        WINDOW_LINES: '5',
        POLL_INTERVAL_MS: '1000', // 1 second polling interval
        CONTROL_SQS_URL: controlQueue.queueUrl,
        AI_MESSAGES_TABLE: aiMessagesTable.tableName,
        CONFIG_TABLE_NAME: orchestratorConfigTable.tableName,
      },
    });
    container.addPortMappings({ containerPort: 3000 });

    const service = new ecs.FargateService(this, 'OrchestratorService', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 1,
      assignPublicIp: true, // PoC: simplify networking
    });

    // === Web assets deployment ===
    // Note: Web assets are deployed separately via `pnpm run web:deploy`
    // This avoids the slow and unreliable BucketDeployment custom resource

    // Grant ECS and CloudFront permissions to admin Lambdas
    // (These are added here because the resources need to be defined first)
    adminCloseFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ecs:UpdateService'],
      resources: [service.serviceArn],
    }));
    adminCloseFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'cloudfront:GetDistributionConfig',
        'cloudfront:UpdateDistribution',
      ],
      resources: [
        `arn:aws:cloudfront::${this.account}:distribution/${webDistribution.distributionId}`,
      ],
    }));

    adminOpenFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ecs:UpdateService'],
      resources: [service.serviceArn],
    }));
    adminOpenFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'cloudfront:GetDistributionConfig',
        'cloudfront:UpdateDistribution',
      ],
      resources: [
        `arn:aws:cloudfront::${this.account}:distribution/${webDistribution.distributionId}`,
      ],
    }));

    // === CloudFormation Outputs ===
    new CfnOutput(this, 'ApiEndpoint', { value: apiBaseUrl });
    new CfnOutput(this, 'DefaultBedrockRegion', { value: 'ap-northeast-1' });
    new CfnOutput(this, 'DefaultModelId', {
      value:
        'arn:aws:bedrock:ap-northeast-1:030046728177:inference-profile/global.anthropic.claude-haiku-4-5-20251001-v1:0',
    });
    new CfnOutput(this, 'TtsDefaultVoice', { value: 'Mizuki' });
    new CfnOutput(this, 'WebUrl', { value: `https://${webDistribution.distributionDomainName}` });
    new CfnOutput(this, 'WebBucketName', { value: siteBucket.bucketName });
    new CfnOutput(this, 'WebDistributionId', { value: webDistribution.distributionId });
    new CfnOutput(this, 'OrchestratorControlQueueUrl', { value: controlQueue.queueUrl });
    new CfnOutput(this, 'OrchestratorServiceName', { value: service.serviceName });
    new CfnOutput(this, 'TranscriptQueueUrl', { value: transcriptQueue.queueUrl });  // ADR-0011
  }
}
