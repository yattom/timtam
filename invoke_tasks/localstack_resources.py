import boto3


def get_dynamodb():
    dynamodb = boto3.resource(
        'dynamodb',
        endpoint_url='http://localhost:4566',
        region_name='ap-northeast-1',
        aws_access_key_id='test',
        aws_secret_access_key='test',
    )
    return dynamodb


def get_sqs():
    sqs = boto3.client(
        'sqs',
        endpoint_url='http://localhost:4566',
        region_name='ap-northeast-1',
        aws_access_key_id='test',
        aws_secret_access_key='test',
    )
    return sqs

