import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import {
  LambdaClient,
  ListFunctionsCommand,
  PutFunctionConcurrencyCommand,
} from '@aws-sdk/client-lambda';
import {
  ECSClient,
  ListServicesCommand,
  UpdateServiceCommand,
} from '@aws-sdk/client-ecs';
import {
  CloudFrontClient,
  ListDistributionsCommand,
  GetDistributionConfigCommand,
  UpdateDistributionCommand,
} from '@aws-sdk/client-cloudfront';
import {
  CloudFormationClient,
  DescribeStackResourcesCommand,
} from '@aws-sdk/client-cloudformation';

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_FUNCTION_NAME = process.env.AWS_LAMBDA_FUNCTION_NAME || '';

const lambdaClient = new LambdaClient({ region: REGION });
const ecsClient = new ECSClient({ region: REGION });
const cloudFrontClient = new CloudFrontClient({ region: REGION });
const cloudFormationClient = new CloudFormationClient({ region: REGION });

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    // パスワード認証
    const password = event.pathParameters?.password;
    if (!password || password !== ADMIN_PASSWORD) {
      return {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result: 'NG', error: 'Invalid password' }),
      };
    }

    // 1. すべてのLambda関数を無効化(ただし、このLambda自体は除く)
    const listFunctionsResp = await lambdaClient.send(new ListFunctionsCommand({}));
    const functions = listFunctionsResp.Functions || [];

    for (const func of functions) {
      const functionName = func.FunctionName || '';
      // TimtamInfraStackで始まる関数のみが対象
      // このLambda自体は除外する
      if (functionName.startsWith('TimtamInfraStack-') && functionName !== ADMIN_FUNCTION_NAME) {
        await lambdaClient.send(
          new PutFunctionConcurrencyCommand({
            FunctionName: functionName,
            ReservedConcurrentExecutions: 0,
          })
        );
      }
    }

    // 2. ECSサービスのdesired countを0に設定
    const stackResourcesResp = await cloudFormationClient.send(
      new DescribeStackResourcesCommand({
        StackName: 'TimtamInfraStack',
      })
    );
    const clusterResource = stackResourcesResp.StackResources?.find(
      (r) => r.ResourceType === 'AWS::ECS::Cluster'
    );

    if (clusterResource?.PhysicalResourceId) {
      const clusterArn = clusterResource.PhysicalResourceId;
      const listServicesResp = await ecsClient.send(
        new ListServicesCommand({ cluster: clusterArn })
      );

      if (listServicesResp.serviceArns && listServicesResp.serviceArns.length > 0) {
        const serviceArn = listServicesResp.serviceArns[0];
        await ecsClient.send(
          new UpdateServiceCommand({
            cluster: clusterArn,
            service: serviceArn,
            desiredCount: 0,
          })
        );
      }
    }

    // 3. CloudFrontディストリビューションを無効化
    const listDistributionsResp = await cloudFrontClient.send(
      new ListDistributionsCommand({})
    );

    if (listDistributionsResp.DistributionList?.Items?.[0]) {
      const distribution = listDistributionsResp.DistributionList.Items[0];
      const distId = distribution.Id;

      if (distId) {
        const getConfigResp = await cloudFrontClient.send(
          new GetDistributionConfigCommand({ Id: distId })
        );

        if (getConfigResp.DistributionConfig && getConfigResp.ETag) {
          const config = getConfigResp.DistributionConfig;
          config.Enabled = false;

          await cloudFrontClient.send(
            new UpdateDistributionCommand({
              Id: distId,
              DistributionConfig: config,
              IfMatch: getConfigResp.ETag,
            })
          );
        }
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result: 'OK' }),
    };
  } catch (err: any) {
    console.error('Error in close handler:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result: 'NG', error: err?.message || String(err) }),
    };
  }
};
