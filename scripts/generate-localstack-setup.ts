#!/usr/bin/env ts-node

/**
 * CDK CloudFormation Template から LocalStack セットアップスクリプトを生成
 *
 * Usage: npx ts-node scripts/generate-localstack-setup.ts
 *
 * このスクリプトは:
 * 1. cdk.out/TimtamInfraStack.template.json を読み込み
 * 2. DynamoDB Tables と SQS Queues を抽出
 * 3. AWS CLI コマンドを含む scripts/setup-localstack.sh を生成
 */

import * as fs from 'fs';
import * as path from 'path';

interface AttributeDefinition {
  AttributeName: string;
  AttributeType: string;
}

interface KeySchemaElement {
  AttributeName: string;
  KeyType: string;
}

interface GlobalSecondaryIndex {
  IndexName: string;
  KeySchema: KeySchemaElement[];
  Projection: {
    ProjectionType: string;
  };
}

interface TimeToLiveSpecification {
  AttributeName: string;
  Enabled: boolean;
}

interface DynamoDBTableProperties {
  TableName: string;
  AttributeDefinitions: AttributeDefinition[];
  KeySchema: KeySchemaElement[];
  BillingMode: string;
  GlobalSecondaryIndexes?: GlobalSecondaryIndex[];
  TimeToLiveSpecification?: TimeToLiveSpecification;
}

interface SQSQueueProperties {
  QueueName?: string;
  FifoQueue?: boolean;
  ContentBasedDeduplication?: boolean;
  MessageRetentionPeriod?: number;
  VisibilityTimeout?: number;
  RedrivePolicy?: {
    deadLetterTargetArn: any;
    maxReceiveCount: number;
  };
}

interface CloudFormationResource {
  Type: string;
  Properties: DynamoDBTableProperties | SQSQueueProperties;
}

interface CloudFormationTemplate {
  Resources: {
    [key: string]: CloudFormationResource;
  };
}

const TEMPLATE_PATH = path.join(process.cwd(), 'infra/cdk/cdk.out/TimtamInfraStack.template.json');
const OUTPUT_PATH = path.join(process.cwd(), 'scripts/setup-localstack.sh');

function generateDynamoDBCommands(tables: DynamoDBTableProperties[]): string[] {
  const commands: string[] = [];

  for (const table of tables) {
    commands.push(`# ${table.TableName}`);

    // Attribute definitions
    const attrs = table.AttributeDefinitions
      .map(a => `AttributeName=${a.AttributeName},AttributeType=${a.AttributeType}`)
      .join(' \\\n    ');

    // Key schema
    const keys = table.KeySchema
      .map(k => `AttributeName=${k.AttributeName},KeyType=${k.KeyType}`)
      .join(' \\\n    ');

    // Base create-table command
    let createCmd = `aws dynamodb create-table \\
  --endpoint-url "$ENDPOINT" \\
  --region "$REGION" \\
  --table-name ${table.TableName} \\
  --attribute-definitions \\
    ${attrs} \\
  --key-schema \\
    ${keys} \\
  --billing-mode ${table.BillingMode}`;

    // Add GSI if exists
    if (table.GlobalSecondaryIndexes && table.GlobalSecondaryIndexes.length > 0) {
      const gsiJson = JSON.stringify(table.GlobalSecondaryIndexes.map(gsi => ({
        IndexName: gsi.IndexName,
        KeySchema: gsi.KeySchema,
        Projection: gsi.Projection
      })));
      createCmd += ` \\\n  --global-secondary-indexes '${gsiJson}'`;
    }

    createCmd += ` \\\n  > /dev/null 2>&1 || echo "  → ${table.TableName} already exists"`;
    commands.push(createCmd);
    commands.push(`echo "✓ ${table.TableName}"`);

    // Add TTL if exists
    if (table.TimeToLiveSpecification?.Enabled) {
      commands.push('');
      commands.push(`# TTL for ${table.TableName}`);
      commands.push(`aws dynamodb update-time-to-live \\
  --endpoint-url "$ENDPOINT" \\
  --region "$REGION" \\
  --table-name ${table.TableName} \\
  --time-to-live-specification "Enabled=true,AttributeName=${table.TimeToLiveSpecification.AttributeName}" \\
  > /dev/null 2>&1 || true`);
    }

    commands.push('');
  }

  return commands;
}

function generateSQSCommands(queues: Array<{ logicalId: string; props: SQSQueueProperties }>): string[] {
  const commands: string[] = [];
  const queueUrlVars: { [logicalId: string]: string } = {};

  // First, create DLQ queues (they need to exist before main queues reference them)
  const dlqQueues = queues.filter(q => q.props.QueueName?.endsWith('-dlq.fifo'));
  const mainQueues = queues.filter(q => !q.props.QueueName?.endsWith('-dlq.fifo'));

  // Generate DLQ creation commands
  for (const queue of dlqQueues) {
    const queueName = queue.props.QueueName || 'UnnamedQueue';
    const varName = queue.logicalId.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    queueUrlVars[queue.logicalId] = varName;

    commands.push(`# ${queueName}`);

    const attributes: string[] = [];
    if (queue.props.FifoQueue) attributes.push('FifoQueue=true');
    if (queue.props.MessageRetentionPeriod) attributes.push(`MessageRetentionPeriod=${queue.props.MessageRetentionPeriod}`);

    let createCmd = `${varName}_URL=$(aws sqs create-queue \\
  --endpoint-url "$ENDPOINT" \\
  --region "$REGION" \\
  --queue-name ${queueName}`;

    if (attributes.length > 0) {
      createCmd += ` \\\n  --attributes ${attributes.join(',')}`;
    }

    createCmd += ` \\\n  --query 'QueueUrl' --output text 2>/dev/null) || echo "  → ${queueName} already exists"`;
    commands.push(createCmd);
    commands.push(`echo "✓ ${queueName}"`);
    commands.push('');
  }

  // Generate main queue creation commands
  for (const queue of mainQueues) {
    const queueName = queue.props.QueueName || 'OrchestratorControlQueue';
    commands.push(`# ${queueName}`);

    const attributes: string[] = [];
    if (queue.props.FifoQueue) attributes.push('FifoQueue=true');
    if (queue.props.ContentBasedDeduplication) attributes.push('ContentBasedDeduplication=true');
    if (queue.props.VisibilityTimeout) attributes.push(`VisibilityTimeout=${queue.props.VisibilityTimeout}`);
    if (queue.props.MessageRetentionPeriod) attributes.push(`MessageRetentionPeriod=${queue.props.MessageRetentionPeriod}`);

    let createCmd = `aws sqs create-queue \\
  --endpoint-url "$ENDPOINT" \\
  --region "$REGION" \\
  --queue-name ${queueName}`;

    if (attributes.length > 0) {
      createCmd += ` \\\n  --attributes ${attributes.join(',')}`;
    }

    createCmd += ` \\\n  > /dev/null 2>&1 || echo "  → ${queueName} already exists"`;
    commands.push(createCmd);
    commands.push(`echo "✓ ${queueName}"`);

    // Set RedrivePolicy separately using jq to avoid escaping issues
    if (queue.props.RedrivePolicy) {
      const dlqRef = queue.props.RedrivePolicy.deadLetterTargetArn;
      if (dlqRef && typeof dlqRef === 'object' && 'Fn::GetAtt' in dlqRef) {
        const dlqLogicalId = dlqRef['Fn::GetAtt'][0];
        const dlqVarName = queueUrlVars[dlqLogicalId];
        if (dlqVarName) {
          const maxReceiveCount = queue.props.RedrivePolicy.maxReceiveCount;
          commands.push('');
          commands.push(`# Set RedrivePolicy for ${queueName}`);
          commands.push(`QUEUE_URL=$(aws sqs get-queue-url \\
  --endpoint-url "$ENDPOINT" \\
  --region "$REGION" \\
  --queue-name ${queueName} \\
  --query 'QueueUrl' --output text 2>/dev/null)`);
          commands.push(`DLQ_ARN=$(aws sqs get-queue-attributes \\
  --endpoint-url "$ENDPOINT" \\
  --region "$REGION" \\
  --queue-url "$` + `{${dlqVarName}_URL}` + `" \\
  --attribute-names QueueArn \\
  --query 'Attributes.QueueArn' --output text 2>/dev/null)`);
          commands.push(`REDRIVE_POLICY=$(jq -n \\
  --arg arn "$DLQ_ARN" \\
  --argjson max ${maxReceiveCount} \\
  '{deadLetterTargetArn: $arn, maxReceiveCount: $max}')`);
          commands.push(`ATTRIBUTES=$(jq -n --argjson policy "$REDRIVE_POLICY" '{RedrivePolicy: ($policy | tostring)}')`);
          commands.push(`aws sqs set-queue-attributes \\
  --endpoint-url "$ENDPOINT" \\
  --region "$REGION" \\
  --queue-url "$QUEUE_URL" \\
  --attributes "$ATTRIBUTES" \\
  > /dev/null 2>&1 || true`);
        }
      }
    }

    commands.push('');
  }

  return commands;
}

function main() {
  console.log('📖 Reading CloudFormation template...');
  const templateContent = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
  const template: CloudFormationTemplate = JSON.parse(templateContent);

  console.log('🔍 Extracting DynamoDB tables and SQS queues...');

  const dynamoTables: DynamoDBTableProperties[] = [];
  const sqsQueues: Array<{ logicalId: string; props: SQSQueueProperties }> = [];

  for (const [logicalId, resource] of Object.entries(template.Resources)) {
    if (resource.Type === 'AWS::DynamoDB::Table') {
      dynamoTables.push(resource.Properties as DynamoDBTableProperties);
    } else if (resource.Type === 'AWS::SQS::Queue') {
      sqsQueues.push({ logicalId, props: resource.Properties as SQSQueueProperties });
    }
  }

  console.log(`  Found ${dynamoTables.length} DynamoDB tables`);
  console.log(`  Found ${sqsQueues.length} SQS queues`);

  console.log('🔨 Generating AWS CLI commands...');
  const dynamoCommands = generateDynamoDBCommands(dynamoTables);
  const sqsCommands = generateSQSCommands(sqsQueues);

  console.log('📝 Writing setup-localstack.sh...');
  const scriptContent = `#!/bin/bash
# This file is AUTO-GENERATED by scripts/generate-localstack-setup.ts
# DO NOT EDIT MANUALLY - Changes will be overwritten
# To update: Run \`pnpm run sync-schema\` in the root directory

set -e

ENDPOINT="http://localhost:4566"
REGION="ap-northeast-1"

echo "========================================="
echo "LocalStack Setup for Timtam"
echo "========================================="
echo "Endpoint: $ENDPOINT"
echo "Region: $REGION"
echo ""

# Wait for LocalStack
echo "Waiting for LocalStack to be ready..."
max_attempts=30
attempt=0
until curl -s "$ENDPOINT/_localstack/health" > /dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ $attempt -ge $max_attempts ]; then
    echo "ERROR: LocalStack did not start within expected time"
    exit 1
  fi
  echo "Attempt $attempt/$max_attempts..."
  sleep 2
done
echo "✓ LocalStack is ready"
echo ""

# DynamoDB Tables
echo "Creating DynamoDB tables..."
echo ""

${dynamoCommands.join('\n')}

# SQS Queues
echo "Creating SQS queues..."
echo ""

${sqsCommands.join('\n')}

# S3 Bucket (manually maintained)
echo "Creating S3 bucket..."

aws s3 mb s3://timtam-local-dev \\
  --endpoint-url "$ENDPOINT" \\
  --region "$REGION" \\
  > /dev/null 2>&1 || echo "  → timtam-local-dev already exists"

echo "✓ timtam-local-dev"

echo ""
echo "========================================="
echo "LocalStack setup complete!"
echo "========================================="
`;

  fs.writeFileSync(OUTPUT_PATH, scriptContent, { mode: 0o755 });

  console.log('✅ Successfully generated setup-localstack.sh');
  console.log('');
  console.log(`Generated script includes:`);
  console.log(`  - ${dynamoTables.length} DynamoDB tables`);
  console.log(`  - ${sqsQueues.length} SQS queues`);
  console.log(`  - 1 S3 bucket`);
  console.log('');
  console.log(`To apply changes, run:`);
  console.log(`  pnpm run local:setup`);
}

main();
