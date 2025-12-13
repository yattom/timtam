import { App } from 'aws-cdk-lib';
import { TimtamInfraStack } from '../lib/stack';

const app = new App();

// CDK_DEFAULT_ACCOUNT / CDK_DEFAULT_REGION は CLI が --profile 等から解決します
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

new TimtamInfraStack(app, 'TimtamInfraStack', { env });
