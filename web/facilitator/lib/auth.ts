'use client';

import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserSession,
} from 'amazon-cognito-identity-js';

const LOCAL_USER_ID_KEY = 'timtam_local_user_id';

export function isLocalDev(): boolean {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
  return apiUrl.startsWith('http://localhost') || apiUrl.startsWith('http://127.0.0.1');
}

export function getLocalUserId(): string {
  if (typeof window === 'undefined') return 'local-dev-user';
  let userId = localStorage.getItem(LOCAL_USER_ID_KEY);
  if (!userId) {
    userId = `local-user-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(LOCAL_USER_ID_KEY, userId);
  }
  return userId;
}

function getUserPool(): CognitoUserPool {
  return new CognitoUserPool({
    UserPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID!,
    ClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!,
  });
}

export function signIn(email: string, password: string): Promise<CognitoUserSession> {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: getUserPool() });
    const authDetails = new AuthenticationDetails({ Username: email, Password: password });
    user.authenticateUser(authDetails, {
      onSuccess: resolve,
      onFailure: reject,
    });
  });
}

export function signUp(email: string, password: string): Promise<void> {
  return new Promise((resolve, reject) => {
    getUserPool().signUp(email, password, [], [], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export function confirmSignUp(email: string, code: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: getUserPool() });
    user.confirmRegistration(code, true, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export function signOut(): void {
  const pool = getUserPool();
  const user = pool.getCurrentUser();
  if (user) user.signOut();
}

export function getCurrentSession(): Promise<CognitoUserSession | null> {
  return new Promise((resolve) => {
    const pool = getUserPool();
    const user = pool.getCurrentUser();
    if (!user) {
      resolve(null);
      return;
    }
    user.getSession((err: any, session: CognitoUserSession | null) => {
      if (err || !session?.isValid()) {
        resolve(null);
      } else {
        resolve(session);
      }
    });
  });
}

export async function getIdToken(): Promise<string | null> {
  const session = await getCurrentSession();
  return session?.getIdToken().getJwtToken() ?? null;
}
