import json
from pathlib import Path
from datetime import datetime

from . import log


def seed_default_grasp_config(dynamodb, table_name='timtam-grasp-configs'):
    """
    Seed the default Grasp configuration to DynamoDB.

    Reads the default configuration from infra/default-grasp-config/default.json
    and writes it to the specified DynamoDB table. If a DEFAULT config already exists
    with the same YAML content, it skips the update (idempotent).

    Args:
        dynamodb: boto3 DynamoDB resource
        table_name: Name of the Grasp configs table
    """
    # Read default config file
    config_path = Path(__file__).parent.parent / 'infra' / 'default-grasp-config' / 'default.json'

    if not config_path.exists():
        log(f"  ⚠ Default config file not found: {config_path}")
        return

    with open(config_path, 'r', encoding='utf-8') as f:
        default_config = json.load(f)

    table = dynamodb.Table(table_name)

    # Check if DEFAULT config already exists
    try:
        response = table.scan(
            FilterExpression='#name = :default_name',
            ExpressionAttributeNames={'#name': 'name'},
            ExpressionAttributeValues={':default_name': 'DEFAULT'}
        )

        existing_configs = response.get('Items', [])

        # Normalize YAML for comparison (remove extra whitespace)
        def normalize_yaml(yaml_str):
            return ' '.join(yaml_str.strip().split())

        new_yaml = normalize_yaml(default_config['yaml'])

        if existing_configs:
            # Sort by configId to get the latest one
            existing_configs.sort(key=lambda x: x.get('configId', ''), reverse=True)
            latest_config = existing_configs[0]
            existing_yaml = normalize_yaml(latest_config.get('yaml', ''))

            if new_yaml == existing_yaml:
                log(f"  → DEFAULT config already exists with same content, skipping")
                return

            log(f"  → DEFAULT config exists but content differs, creating new version")
        else:
            log(f"  → No DEFAULT config found, creating new one")

    except Exception as e:
        log.error(f"  ⚠ Error checking existing config: {e}")
        log.error(f"  → Proceeding with config creation")

    # Create new config with timestamp-based configId
    now = datetime.utcnow()
    timestamp = now.strftime('%Y%m%dT%H%M%S')
    config_id = f"DEFAULT_{timestamp}"

    item = {
        'configId': config_id,
        'name': default_config['name'],
        'yaml': default_config['yaml'],
        'createdAt': int(now.timestamp() * 1000),
        'updatedAt': int(now.timestamp() * 1000),
    }

    table.put_item(Item=item)
    log(f"  ✓ DEFAULT Grasp config seeded: {config_id}")
