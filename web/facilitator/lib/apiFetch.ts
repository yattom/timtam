import { isLocalDev, getLocalUserId, getIdToken } from './auth';

export async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

  const authHeader: Record<string, string> = isLocalDev()
    ? { 'X-User-Id': getLocalUserId() }
    : { 'Authorization': `Bearer ${await getIdToken()}` };

  return fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeader,
      ...(options?.headers as Record<string, string> | undefined),
    },
  });
}
