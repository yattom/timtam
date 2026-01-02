import 'dotenv/config';
import { App } from 'aws-cdk-lib';
import { TimtamInfraStack } from '../lib/stack';

const app = new App();

// Prefer explicit env for PoC to avoid context resolution issues
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT || '550251267268',
  region: process.env.CDK_DEFAULT_REGION || 'ap-northeast-1',
};

new TimtamInfraStack(app, 'TimtamInfraStack', { env });
