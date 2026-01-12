import {
  CloudFormationClient,
  DescribeStackResourcesCommand,
  DescribeStacksCommand,
} from '@aws-sdk/client-cloudformation';
import {
  LambdaClient,
  PutFunctionConcurrencyCommand,
  DeleteFunctionConcurrencyCommand,
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
import { APIGatewayProxyEventV2 } from 'aws-lambda';

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const cloudFormationClient = new CloudFormationClient({ region: REGION });
const lambdaClient = new LambdaClient({ region: REGION });
const ecsClient = new ECSClient({ region: REGION });
const cloudFrontClient = new CloudFrontClient({ region: REGION });

/**
 * CloudFormationスタックからリソースARNのリストを取得する
 */
export async function getStackResourceArns(
  stackName: string,
  resourceType: string
): Promise<string[]> {
  const stackResourcesResp = await cloudFormationClient.send(
    new DescribeStackResourcesCommand({ StackName: stackName })
  );

  const resources = stackResourcesResp.StackResources?.filter(
    (r) => r.ResourceType === resourceType && r.PhysicalResourceId
  ) || [];

  return resources.map((r) => r.PhysicalResourceId!);
}

/**
 * CloudFormationスタックのOutputから値を取得する
 */
export async function getStackOutput(
  stackName: string,
  outputKey: string
): Promise<string | undefined> {
  const stacksResp = await cloudFormationClient.send(
    new DescribeStacksCommand({ StackName: stackName })
  );

  const stack = stacksResp.Stacks?.[0];
  if (!stack) {
    console.error(`CloudFormation stack not found: ${stackName}`);
    return undefined;
  }

  const output = stack.Outputs?.find((o) => o.OutputKey === outputKey);
  if (!output) {
    console.error(`Stack output not found: ${outputKey} in stack ${stackName}`);
  }
  return output?.OutputValue;
}

/**
 * 管理用Lambda関数名のリストを取得する
 */
export async function getAdminLambdaNames(): Promise<string[]> {
  const lambdaArns = await getStackResourceArns(
    'TimtamInfraStack',
    'AWS::Lambda::Function'
  );

  // ARNから関数名を抽出し、admin-apiを含むものを返す
  return lambdaArns
    .map((arn) => arn.split(':').pop() || '')
    .filter((name) => name.includes('AdminCloseFn') || name.includes('AdminOpenFn'));
}

/**
 * TimtamInfraStackのすべてのLambda関数名を取得する（管理用Lambda除く）
 */
export async function getTargetLambdaNames(): Promise<string[]> {
  const adminLambdaNames = await getAdminLambdaNames();
  const allLambdaArns = await getStackResourceArns(
    'TimtamInfraStack',
    'AWS::Lambda::Function'
  );

  // ARNから関数名を抽出し、管理用Lambda以外を返す
  return allLambdaArns
    .map((arn) => arn.split(':').pop() || '')
    .filter((name) => name && !adminLambdaNames.includes(name));
}

/**
 * パスワード認証を行う
 */
export function authenticatePassword(event: APIGatewayProxyEventV2): boolean {
  const password = event.pathParameters?.password;
  return password === ADMIN_PASSWORD && ADMIN_PASSWORD !== '';
}

/**
 * Lambda関数の有効化/無効化を行う
 */
async function manageLambdaFunctions(enable: boolean): Promise<void> {
  const targetLambdaNames = await getTargetLambdaNames();

  for (const functionName of targetLambdaNames) {
    if (enable) {
      try {
        await lambdaClient.send(
          new DeleteFunctionConcurrencyCommand({
            FunctionName: functionName,
          })
        );
      } catch (err: any) {
        // 既に制限がない場合はエラーになるが、それは正常な状態なので無視
        if (err.name === 'ResourceNotFoundException') {
          continue;
        }
        throw err;
      }
    } else {
      await lambdaClient.send(
        new PutFunctionConcurrencyCommand({
          FunctionName: functionName,
          ReservedConcurrentExecutions: 0,
        })
      );
    }
  }
}

/**
 * ECSサービスのdesired countを設定する
 */
async function manageECSServices(desiredCount: number): Promise<void> {
  const clusterArns = await getStackResourceArns('TimtamInfraStack', 'AWS::ECS::Cluster');

  for (const clusterArn of clusterArns) {
    const listServicesResp = await ecsClient.send(
      new ListServicesCommand({ cluster: clusterArn })
    );

    if (listServicesResp.serviceArns && listServicesResp.serviceArns.length > 0) {
      for (const serviceArn of listServicesResp.serviceArns) {
        await ecsClient.send(
          new UpdateServiceCommand({
            cluster: clusterArn,
            service: serviceArn,
            desiredCount,
          })
        );
      }
    }
  }
}

/**
 * CloudFrontディストリビューションの有効化/無効化を行う
 */
async function manageCloudFront(enabled: boolean): Promise<void> {
  // CloudFormation Stack OutputからDistribution IDを取得
  const distId = await getStackOutput('TimtamInfraStack', 'WebDistributionId');

  if (!distId) {
    console.error('CloudFront Distribution ID not found in stack outputs');
    return;
  }

  console.log(`Managing CloudFront distribution: ${distId}, enabled: ${enabled}`);
  
  const getConfigResp = await cloudFrontClient.send(
    new GetDistributionConfigCommand({ Id: distId })
  );

  if (!getConfigResp.DistributionConfig || !getConfigResp.ETag) {
    console.error(`Failed to get CloudFront distribution config or ETag for ${distId}`);
    return;
  }

  const config = getConfigResp.DistributionConfig;
  config.Enabled = enabled;

  await cloudFrontClient.send(
    new UpdateDistributionCommand({
      Id: distId,
      DistributionConfig: config,
      IfMatch: getConfigResp.ETag,
    })
  );
  console.log(`CloudFront distribution ${distId} updated successfully`);
}

/**
 * インフラ全体の有効化/無効化を行う
 */
export async function manageInfrastructure(enable: boolean): Promise<void> {
  await manageLambdaFunctions(enable);
  await manageECSServices(enable ? 1 : 0);
  await manageCloudFront(enable);
}
