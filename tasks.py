from invoke import task
import boto3

from invoke_tasks import log, clear_dynamodb_table, purge_sqs_queue, seed_default_grasp_config


@task
def hello(c, name='yattom', verbose=False):
    """Say hello to someone"""
    log.set_verbose(verbose)
    log(f"Hello, {name}!")
    log.error('This is an example of an error message')


@task
def delete_localstack_data(c, verbose=False):
    """Clear all data from LocalStack DynamoDB tables and SQS queues."""
    log.set_verbose(verbose)
    log("=========================================")
    log("Clearing LocalStack data...")
    log("=========================================")
    log()

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
            log.error(f"  → Error clearing {table_name}: {e}")

    log()

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

    log()
    log("=========================================")
    log("Data cleared!")
    log("=========================================")


@task
def seed_default_config_local(c, verbose=False):
    """Seed default Grasp configuration to LocalStack."""
    log.set_verbose(verbose)
    log("=========================================")
    log("Seeding default Grasp configuration (LocalStack)...")
    log("=========================================")
    log()

    # DynamoDB setup for LocalStack
    dynamodb = boto3.resource(
        'dynamodb',
        endpoint_url='http://localhost:4566',
        region_name='ap-northeast-1',
        aws_access_key_id='test',
        aws_secret_access_key='test',
    )

    seed_default_grasp_config(dynamodb, 'timtam-grasp-configs')

    log()
    log("=========================================")
    log("Default config seeded!")
    log("=========================================")


@task
def seed_default_config_aws(c, region='ap-northeast-1', profile='admin', verbose=False):
    """Seed default Grasp configuration to AWS."""
    log.set_verbose(verbose)
    log("=========================================")
    log("Seeding default Grasp configuration (AWS)...")
    log("=========================================")
    log()

    # DynamoDB setup for AWS with explicit profile
    session = boto3.Session(profile_name=profile, region_name=region)
    dynamodb = session.resource('dynamodb')

    seed_default_grasp_config(dynamodb, 'timtam-grasp-configs')

    log()
    log("=========================================")
    log("Default config seeded!")
    log("=========================================")

