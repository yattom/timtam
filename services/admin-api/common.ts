import {
  CloudFormationClient,
  DescribeStackResourcesCommand,
} from '@aws-sdk/client-cloudformation';
import { APIGatewayProxyEventV2 } from 'aws-lambda';

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const cloudFormationClient = new CloudFormationClient({ region: REGION });

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
