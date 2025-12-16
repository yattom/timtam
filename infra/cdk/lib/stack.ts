import { Stack, StackProps, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CfnApi, CfnIntegration, CfnRoute, CfnStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Duration } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as kinesis from 'aws-cdk-lib/aws-kinesis';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as fs from 'fs';

export class TimtamInfraStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // HTTP API は Web Distribution 作成後に定義して、CORS に CF ドメインを含める

    // === DynamoDB table for Media Pipeline ARNs ===
    const mediaPipelineTable = new dynamodb.Table(this, 'MediaPipelineTable', {
      tableName: 'timtam-media-pipelines',
      partitionKey: { name: 'meetingId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: this.node.tryGetContext('keepTables') ? undefined : RemovalPolicy.DESTROY,
    });

    // === Kinesis stream (created early so we can reference it in Lambda env) ===
    const transcriptStream = new kinesis.Stream(this, 'TranscriptAsrStream', {
      streamName: 'transcript-asr',
      streamMode: kinesis.StreamMode.ON_DEMAND,
      retentionPeriod: Duration.hours(24),
    });

    // === S3 bucket for Media Capture Pipeline audio ===
    const mediaCaptureBucket = new s3.Bucket(this, 'MediaCaptureBucket', {
      bucketName: `timtam-media-capture-${this.account}-${this.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      lifecycleRules: [
        {
          expiration: Duration.days(1), // Auto-delete after 1 day (PoC)
        },
      ],
    });

    // Bucket policy for Chime Media Pipelines service
    // Based on AWS sample: https://github.com/aws-samples/amazon-chime-media-capture-pipeline-demo
    // Security conditions prevent confused deputy attacks
    mediaCaptureBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AWSChimeMediaCaptureBucketPolicy',
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal('mediapipelines.chime.amazonaws.com')],
        actions: [
          's3:PutObject',
          's3:PutObjectAcl',
        ],
        resources: [
          `${mediaCaptureBucket.bucketArn}/*`,
        ],
        conditions: {
          StringEquals: {
            'aws:SourceAccount': this.account,
          },
          ArnLike: {
            'aws:SourceArn': `arn:aws:chime:*:${this.account}:*`,
          },
        },
      })
    );

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
      environment: {
        PIPELINE_TABLE_NAME: mediaPipelineTable.tableName,
        CAPTURE_BUCKET_ARN: mediaCaptureBucket.bucketArn,
        AWS_ACCOUNT_ID: this.account,
      },
    });

    const transcriptionStopFn = new NodejsFunction(this, 'TranscriptionStopFn', {
      entry: '../../services/meeting-api/transcriptionStop.ts',
      handler: 'stop',
      timeout: Duration.seconds(15),
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        PIPELINE_TABLE_NAME: mediaPipelineTable.tableName,
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

    // Media Pipelines permissions for transcription Lambdas
    const mediaPipelinePolicies = new iam.PolicyStatement({
      actions: [
        'chime:CreateMediaCapturePipeline',
        'chime:DeleteMediaCapturePipeline',
        'chime:GetMediaCapturePipeline',
      ],
      resources: ['*'],
    });
    transcriptionStartFn.addToRolePolicy(mediaPipelinePolicies);
    transcriptionStopFn.addToRolePolicy(mediaPipelinePolicies);

    // Grant DynamoDB access to transcription Lambdas
    mediaPipelineTable.grantReadWriteData(transcriptionStartFn);
    mediaPipelineTable.grantReadWriteData(transcriptionStopFn);

    // CRITICAL: Grant Lambda read/write access to capture bucket
    // Required per AWS sample for CreateMediaCapturePipeline to succeed
    mediaCaptureBucket.grantReadWrite(transcriptionStartFn);
    mediaCaptureBucket.grantReadWrite(transcriptionStopFn);

    // Ensure the Chime transcription service-linked role exists in this account
    // Required for Amazon Chime SDK live transcription with Amazon Transcribe
    new iam.CfnServiceLinkedRole(this, 'ChimeTranscriptionSlr', {
      awsServiceName: 'transcription.chime.amazonaws.com',
      description: 'Service-linked role for Amazon Chime transcription',
    });

    // Ensure the Chime Media Pipelines service-linked role exists in this account
    // Required for Amazon Chime SDK Media Pipelines to access S3
    new iam.CfnServiceLinkedRole(this, 'ChimeMediaPipelinesSlr', {
      awsServiceName: 'mediapipelines.chime.amazonaws.com',
      description: 'Service-linked role for Amazon Chime Media Pipelines',
    });

    // === Audio Consumer Lambda (S3 → Transcribe → Kinesis) ===
    const audioConsumerFn = new NodejsFunction(this, 'AudioConsumerFn', {
      entry: '../../services/audio-consumer/handler.ts',
      timeout: Duration.minutes(5), // Audio processing can take time
      memorySize: 512,
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        KINESIS_STREAM_NAME: transcriptStream.streamName,
      },
    });

    // Grant permissions for audio consumer
    mediaCaptureBucket.grantRead(audioConsumerFn);
    transcriptStream.grantWrite(audioConsumerFn);
    audioConsumerFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'transcribe:StartTranscriptionJob',
          'transcribe:GetTranscriptionJob',
        ],
        resources: ['*'],
      })
    );

    // S3 event notification to trigger audio consumer
    // Chime Media Capture can write either .wav or .mp4 files depending on configuration
    mediaCaptureBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(audioConsumerFn),
      { suffix: '.wav' }
    );
    mediaCaptureBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(audioConsumerFn),
      { suffix: '.mp4' }
    );

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

    // === Orchestrator Control (SQS + Lambda trigger from UI) ===
    const controlQueue = new sqs.Queue(this, 'OrchestratorControlQueue', {
      visibilityTimeout: Duration.seconds(10),
      retentionPeriod: Duration.days(1),
    });

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
    const webOai = new cloudfront.OriginAccessIdentity(this, 'WebOAI');
    siteBucket.grantRead(webOai);

    const webDistribution = new cloudfront.Distribution(this, 'WebDistribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: new origins.S3Origin(siteBucket, { originAccessIdentity: webOai }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      errorResponses: [
        { httpStatus: 403, responsePagePath: '/index.html', responseHttpStatus: 200 },
        { httpStatus: 404, responsePagePath: '/index.html', responseHttpStatus: 200 },
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
        allowMethods: ['GET', 'POST', 'OPTIONS'],
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

    // Allow API Gateway to invoke these Lambdas
    const sourceArn = `arn:aws:execute-api:${this.region}:${this.account}:${httpApi.ref}/*/*/*`;
    [createMeetingFn, addAttendeeFn, transcriptionStartFn, transcriptionStopFn].forEach((fn, i) => {
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

    // === ECS Fargate Orchestrator (always-on service) ===
    // Use default VPC lookup (original design); relies on CDK env/account/region being set
    const vpc = ec2.Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true });
    const cluster = new ecs.Cluster(this, 'OrchestratorCluster', { vpc });

    const taskRole = new iam.Role(this, 'OrchestratorTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    // Permissions: Kinesis read, Bedrock invoke, CloudWatch metrics, SQS consume
    taskRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'kinesis:DescribeStream',
        'kinesis:GetShardIterator',
        'kinesis:GetRecords'
      ],
      resources: [transcriptStream.streamArn],
    }));
    taskRole.addToPolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: ['*'],
    }));
    taskRole.addToPolicy(new iam.PolicyStatement({
      actions: ['cloudwatch:PutMetricData'],
      resources: ['*'],
    }));
    controlQueue.grantConsumeMessages(taskRole);

    const taskDef = new ecs.FargateTaskDefinition(this, 'OrchestratorTaskDef', {
      cpu: 512,
      memoryLimitMiB: 1024,
      taskRole,
    });
    const logGroup = new logs.LogGroup(this, 'OrchestratorLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
    });
    const container = taskDef.addContainer('OrchestratorContainer', {
      image: ecs.ContainerImage.fromAsset('../../services/orchestrator', {
        file: 'Dockerfile',
      }),
      logging: ecs.LogDriver.awsLogs({ logGroup, streamPrefix: 'orchestrator' }),
      environment: {
        // Stream name: can be changed later; default here is a functional name
        KINESIS_STREAM_NAME: transcriptStream.streamName,
        BEDROCK_REGION: 'ap-northeast-1',
        BEDROCK_MODEL_ID: 'arn:aws:bedrock:ap-northeast-1:030046728177:inference-profile/global.anthropic.claude-haiku-4-5-20251001-v1:0',
        WINDOW_LINES: '5',
        POLL_INTERVAL_MS: '1000', // 1 second to avoid Kinesis rate limits (5 req/sec max)
        CONTROL_SQS_URL: controlQueue.queueUrl,
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
    // Web assets deployment with invalidation (skip if dist not present)
    const webDistPath = '../../web/timtam-web/dist';
    if (fs.existsSync(webDistPath)) {
      new s3deploy.BucketDeployment(this, 'DeployWeb', {
        sources: [s3deploy.Source.asset(webDistPath)],
        destinationBucket: siteBucket,
        distribution: webDistribution,
        distributionPaths: ['/*'],
      });
    }

    // Deploy runtime config.js with API base URL
    new s3deploy.BucketDeployment(this, 'DeployConfig', {
      sources: [
        s3deploy.Source.data('config.js', `window.API_BASE_URL='${apiBaseUrl}';`)
      ],
      destinationBucket: siteBucket,
      distribution: webDistribution,
      distributionPaths: ['/config.js'],
    });

    // === CloudFormation Outputs ===
    new CfnOutput(this, 'ApiEndpoint', { value: apiBaseUrl });
    new CfnOutput(this, 'DefaultBedrockRegion', { value: 'ap-northeast-1' });
    new CfnOutput(this, 'DefaultModelId', {
      value:
        'arn:aws:bedrock:ap-northeast-1:030046728177:inference-profile/global.anthropic.claude-haiku-4-5-20251001-v1:0',
    });
    new CfnOutput(this, 'TtsDefaultVoice', { value: 'Mizuki' });
    new CfnOutput(this, 'WebUrl', { value: `https://${webDistribution.distributionDomainName}` });
    new CfnOutput(this, 'OrchestratorControlQueueUrl', { value: controlQueue.queueUrl });
    new CfnOutput(this, 'OrchestratorServiceName', { value: service.serviceName });
    new CfnOutput(this, 'TranscriptStreamName', { value: transcriptStream.streamName });
  }
}
