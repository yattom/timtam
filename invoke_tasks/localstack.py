def clear_dynamodb_table(dynamodb, table_name):
    """Clear all data from a DynamoDB table by scanning and deleting items."""
    table = dynamodb.Table(table_name)

    # Get key schema dynamically
    key_schema = table.key_schema
    hash_key = next(k['AttributeName'] for k in key_schema if k['KeyType'] == 'HASH')
    range_key = next((k['AttributeName'] for k in key_schema if k['KeyType'] == 'RANGE'), None)

    print(f"Clearing {table_name}...")

    # Scan and delete with pagination support
    total_deleted = 0
    response = table.scan()

    while True:
        items = response.get('Items', [])

        if not items:
            print(f"  → {table_name} is already empty")
            break

        for item in items:
            key = {hash_key: item[hash_key]}
            if range_key:
                key[range_key] = item[range_key]
            table.delete_item(Key=key)
            total_deleted += 1

        # Check for more pages
        if 'LastEvaluatedKey' not in response:
            break
        response = table.scan(ExclusiveStartKey=response['LastEvaluatedKey'])

    if total_deleted > 0:
        print(f"  ✓ {table_name} cleared ({total_deleted} items deleted)")


def purge_sqs_queue(sqs, queue_url):
    """Purge all messages from an SQS queue."""
    queue_name = queue_url.split('/')[-1]
    print(f"Purging {queue_name}...")

    try:
        sqs.purge_queue(QueueUrl=queue_url)
        print(f"  ✓ {queue_name} purged")
    except Exception as e:
        if 'NonExistentQueue' in str(e) or 'QueueDoesNotExist' in str(e):
            print(f"  → {queue_name} does not exist")
        else:
            print(f"  → {queue_name} is empty or error: {e}")


