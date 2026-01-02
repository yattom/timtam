import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import {
  LambdaClient,
  PutFunctionConcurrencyCommand,
} from '@aws-sdk/client-lambda';
import {
  ECSClient,
  ListServicesCommand,
  UpdateServiceCommand,
} from '@aws-sdk/client-ecs';
import {
  CloudFrontClient,
  GetDistributionConfigCommand,
  UpdateDistributionCommand,
} from '@aws-sdk/client-cloudfront';
import { authenticatePassword, getTargetLambdaNames, getStackResourceArns } from './common';

const REGION = process.env.AWS_REGION || 'ap-northeast-1';

const lambdaClient = new LambdaClient({ region: REGION });
const ecsClient = new ECSClient({ region: REGION });
const cloudFrontClient = new CloudFrontClient({ region: REGION });

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    // パスワード認証
    if (!authenticatePassword(event)) {
      return {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result: 'NG', error: 'Invalid password' }),
      };
    }

    // 1. すべてのLambda関数を無効化(ただし、管理用Lambda関数は除く)
    const targetLambdaNames = await getTargetLambdaNames();

    for (const functionName of targetLambdaNames) {
      await lambdaClient.send(
        new PutFunctionConcurrencyCommand({
          FunctionName: functionName,
          ReservedConcurrentExecutions: 0,
        })
      );
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
    const distributionIds = await getStackResourceArns(
      'TimtamInfraStack',
      'AWS::CloudFront::Distribution'
    );

    if (distributionIds.length > 0) {
      const distId = distributionIds[0];
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

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        result: 'OK',
        message: 'インフラをクローズしました。CloudFrontの反映には1分ほどかかる場合があります。',
      }),
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
