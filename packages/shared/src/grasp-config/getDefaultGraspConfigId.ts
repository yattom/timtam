import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

/**
 * Get the latest DEFAULT Grasp configuration ID from DynamoDB
 *
 * This function scans for configurations with name = "DEFAULT" and returns
 * the most recent one (sorted by configId which contains timestamp).
 *
 * @param region AWS region
 * @param graspConfigsTable Table name for grasp configs
 * @returns configId of the latest DEFAULT configuration, or null if none found
 */
export async function getDefaultGraspConfigId(
  region: string,
  graspConfigsTable: string
): Promise<string | null> {
  const ddbClient = new DynamoDBClient({ region });
  const ddb = DynamoDBDocumentClient.from(ddbClient);

  try {
    // Scan for configs with name 'DEFAULT'
    const result = await ddb.send(
      new ScanCommand({
        TableName: graspConfigsTable,
        FilterExpression: '#name = :defaultName',
        ExpressionAttributeNames: {
          '#name': 'name',
        },
        ExpressionAttributeValues: {
          ':defaultName': 'DEFAULT',
        },
      })
    );

    if (!result.Items || result.Items.length === 0) {
      console.log(JSON.stringify({
        type: 'graspConfig.noDefaultFound',
        message: 'No DEFAULT config found in DynamoDB',
        ts: Date.now(),
      }));
      return null;
    }

    // Sort by configId (which contains timestamp) to get the latest
    interface ConfigItem {
      configId: string;
    }

    const sortedConfigs = (result.Items as ConfigItem[]).sort((a, b) => {
      return b.configId.localeCompare(a.configId);
    });

    const latestConfig = sortedConfigs[0];

    console.log(JSON.stringify({
      type: 'graspConfig.defaultFound',
      configId: latestConfig.configId,
      ts: Date.now(),
    }));

    return latestConfig.configId;
  } catch (error) {
    console.error(JSON.stringify({
      type: 'graspConfig.defaultLookupError',
      error: (error as Error).message,
      ts: Date.now(),
    }));
    return null;
  }
}
