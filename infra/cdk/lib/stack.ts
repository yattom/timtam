import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CfnApi } from 'aws-cdk-lib/aws-apigatewayv2';

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

    // ルートや統合は後続のTODO（meetingHandler 等の追加）で作成します。
  }
}
