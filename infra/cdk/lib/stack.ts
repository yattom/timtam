import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class TimtamInfraStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // TODO: ここにHTTP APIやLambda等を順次追加していきます。
  }
}
