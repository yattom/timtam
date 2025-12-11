import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CfnApi, CfnIntegration, CfnRoute, CfnStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Duration } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';

export class TimtamInfraStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // HTTP API（L1: CfnApi）を作成（CORSは後で必要に応じて詳細化）
    const httpApi = new CfnApi(this, 'HttpApi', {
      name: 'timtam-http-api',
      protocolType: 'HTTP',
      corsConfiguration: {
        allowOrigins: ['*'],
        allowMethods: ['GET', 'POST', 'OPTIONS'],
        allowHeaders: ['*'],
        exposeHeaders: [],
        maxAge: 3600,
      },
    });

    // === Meeting API Lambdas（作成のみ。ルートは後続のTODOで追加） ===
    const createMeetingFn = new NodejsFunction(this, 'CreateMeetingFn', {
      entry: '../../services/meeting-api/createMeeting.ts',
      timeout: Duration.seconds(15),
    });

    const addAttendeeFn = new NodejsFunction(this, 'AddAttendeeFn', {
      entry: '../../services/meeting-api/attendees.ts',
      handler: 'add',
      timeout: Duration.seconds(15),
    });

    const transcriptionStartFn = new NodejsFunction(this, 'TranscriptionStartFn', {
      entry: '../../services/meeting-api/transcriptionStart.ts',
      handler: 'start',
      timeout: Duration.seconds(15),
    });

    const transcriptionStopFn = new NodejsFunction(this, 'TranscriptionStopFn', {
      entry: '../../services/meeting-api/transcriptionStop.ts',
      handler: 'stop',
      timeout: Duration.seconds(15),
    });

    // 必要最小のIAM権限を付与（PoCのためワイルドカード。後でリソース制限へ）
    const meetingPolicies = new iam.PolicyStatement({
      actions: [
        'chime:CreateMeeting',
        'chime:CreateAttendee',
        'chime:DeleteMeeting',
        'chime:StartMeetingTranscription',
        'chime:StopMeetingTranscription',
      ],
      resources: ['*'],
    });
    createMeetingFn.addToRolePolicy(meetingPolicies);
    addAttendeeFn.addToRolePolicy(meetingPolicies);
    transcriptionStartFn.addToRolePolicy(meetingPolicies);
    transcriptionStopFn.addToRolePolicy(meetingPolicies);

    // === API Gateway HTTP API: Integrations & Routes ===
    // Default Stage (auto deploy)
    const stage = new CfnStage(this, 'HttpApiStage', {
      apiId: httpApi.ref,
      stageName: '$default',
      autoDeploy: true,
    });

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
  }
}
