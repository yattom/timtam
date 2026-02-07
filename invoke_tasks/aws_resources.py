import boto3


def get_dynamodb(profile_name, region_name):
    session = boto3.Session(profile_name=profile_name, region_name=region_name)
    dynamodb = session.resource('dynamodb')
    return dynamodb
