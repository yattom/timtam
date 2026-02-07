from invoke import task

from invoke_tasks import log, clear_dynamodb_table, purge_sqs_queue, seed_default_grasp_config
from invoke_tasks import aws_resources as aws
from invoke_tasks import localstack_resources as localstack


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


    # Clear DynamoDB tables
    tables = [
        'timtam-ai-messages',
        'timtam-meetings-metadata',
        'timtam-orchestrator-config',
        'timtam-grasp-configs',
    ]

    dynamodb = localstack.get_dynamodb()
    for table_name in tables:
        try:
            clear_dynamodb_table(dynamodb, table_name)
        except Exception as e:
            log.error(f"  → Error clearing {table_name}: {e}")

    log()


    # Purge SQS queues
    queues = [
        'http://localhost:4566/000000000000/transcript-asr.fifo',
        'http://localhost:4566/000000000000/transcript-asr-dlq.fifo',
        'http://localhost:4566/000000000000/OrchestratorControlQueue',
    ]

    sqs = localstack.get_sqs()
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

    seed_default_grasp_config(localstack.get_dynamodb(), 'timtam-grasp-configs')

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

    seed_default_grasp_config(aws.get_dynamodb(profile, region), 'timtam-grasp-configs')

    log()
    log("=========================================")
    log("Default config seeded!")
    log("=========================================")

