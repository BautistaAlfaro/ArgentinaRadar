/**
 * Auth API client for ArgentinaRadar.
 *
 * Calls the auth service on port 3010 for register, login, refresh,
 * logout, and /me endpoints.
 */

const AUTH_API = 'http://localhost:3010';

export interface AuthUserData {
  id: string;
  email: string;
  role: 'VISITOR' | 'VIP' | 'ADMIN';
}

interface AuthResponse {
  user: AuthUserData;
  accessToken: string;
  refreshToken?: string;
}

interface ErrorBody {
  message?: string;
  error?: string;
}

async function handleResponse<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    let message = `Error ${resp.status}`;
    try {
      const body: ErrorBody = await resp.json();
      message = body.message ?? body.error ?? message;
    } catch {
      // response body is not JSON
    }
    throw new Error(message);
  }
  return resp.json();
}

export async function loginUser(email: string, password: string): Promise<AuthResponse> {
  const resp = await fetch(`${AUTH_API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return handleResponse<AuthResponse>(resp);
}

export async function registerUser(email: string, password: string): Promise<AuthResponse> {
  const resp = await fetch(`${AUTH_API}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return handleResponse<AuthResponse>(resp);
}

export async function refreshTokenApi(token: string): Promise<{ accessToken: string; refreshToken?: string }> {
  const resp = await fetch(`${AUTH_API}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: token }),
  });
  return handleResponse<{ accessToken: string; refreshToken?: string }>(resp);
}

export async function logoutUser(accessToken: string): Promise<void> {
  await fetch(`${AUTH_API}/api/auth/logout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

export async function fetchCurrentUser(accessToken: string): Promise<AuthUserData> {
  const resp = await fetch(`${AUTH_API}/api/auth/me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const data = await handleResponse<{ user: AuthUserData }>(resp);
  return data.user;
}
