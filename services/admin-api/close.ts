import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { authenticatePassword, manageInfrastructure } from './common';

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    // パスワード認証
    if (!authenticatePassword(event)) {
      return {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result: 'NG', error: 'Invalid password' }),
      };
    }

    // インフラをクローズ
    await manageInfrastructure(false);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        result: 'OK',
        message: 'インフラをクローズしました。CloudFrontの反映には1分ほどかかる場合があります。',
      }),
    };
  } catch (err: any) {
    console.error('Error in close handler:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result: 'NG', error: err?.message || String(err) }),
    };
  }
};
