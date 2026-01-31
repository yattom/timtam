from invoke import task
import boto3

from invoke_tasks import clear_dynamodb_table, purge_sqs_queue

@task
def hello(c, name='yattom'):
    """Say hello to someone"""
    print(f"Hello, {name}!")


@task
def delete_localstack_data(c):
    """Clear all data from LocalStack DynamoDB tables and SQS queues."""
    print("=========================================")
    print("Clearing LocalStack data...")
    print("=========================================")
    print()

    # DynamoDB setup
    dynamodb = boto3.resource(
        'dynamodb',
        endpoint_url='http://localhost:4566',
        region_name='ap-northeast-1',
        aws_access_key_id='test',
        aws_secret_access_key='test',
    )

    # Clear DynamoDB tables
    tables = [
        'timtam-ai-messages',
        'timtam-meetings-metadata',
        'timtam-orchestrator-config',
        'timtam-grasp-configs',
    ]

    for table_name in tables:
        try:
            clear_dynamodb_table(dynamodb, table_name)
        except Exception as e:
            print(f"  → Error clearing {table_name}: {e}")

    print()

    # SQS setup
    sqs = boto3.client(
        'sqs',
        endpoint_url='http://localhost:4566',
        region_name='ap-northeast-1',
        aws_access_key_id='test',
        aws_secret_access_key='test',
    )

    # Purge SQS queues
    queues = [
        'http://localhost:4566/000000000000/transcript-asr.fifo',
        'http://localhost:4566/000000000000/transcript-asr-dlq.fifo',
        'http://localhost:4566/000000000000/OrchestratorControlQueue',
    ]

    for queue_url in queues:
        purge_sqs_queue(sqs, queue_url)

    print()
    print("=========================================")
    print("Data cleared!")
    print("=========================================")

