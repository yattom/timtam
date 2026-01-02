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
import { getAdminLambdaNames, getStackResourceArns } from './common';

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

const lambdaClient = new LambdaClient({ region: REGION });
const ecsClient = new ECSClient({ region: REGION });
const cloudFrontClient = new CloudFrontClient({ region: REGION });

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

    // 1. すべてのLambda関数を無効化(ただし、管理用Lambda関数は除く)
    const adminLambdaNames = await getAdminLambdaNames();
    const listFunctionsResp = await lambdaClient.send(new ListFunctionsCommand({}));
    const functions = listFunctionsResp.Functions || [];

    for (const func of functions) {
      const functionName = func.FunctionName || '';
      // TimtamInfraStackで始まる関数のみが対象
      // 管理用Lambda(AdminCloseFn, AdminOpenFn)は除外する
      if (
        functionName.startsWith('TimtamInfraStack-') &&
        !adminLambdaNames.includes(functionName)
      ) {
        await lambdaClient.send(
          new PutFunctionConcurrencyCommand({
            FunctionName: functionName,
            ReservedConcurrentExecutions: 0,
          })
        );
      }
    }

    // 2. ECSサービスのdesired countを0に設定
    const clusterArns = await getStackResourceArns('TimtamInfraStack', 'AWS::ECS::Cluster');

    for (const clusterArn of clusterArns) {
      const listServicesResp = await ecsClient.send(
        new ListServicesCommand({ cluster: clusterArn })
      );

      if (listServicesResp.serviceArns && listServicesResp.serviceArns.length > 0) {
        // すべてのサービスを処理する
        for (const serviceArn of listServicesResp.serviceArns) {
          await ecsClient.send(
            new UpdateServiceCommand({
              cluster: clusterArn,
              service: serviceArn,
              desiredCount: 0,
            })
          );
        }
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
