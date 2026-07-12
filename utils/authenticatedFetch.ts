let tokenGetter: (() => string | null) | null = null;
let cachedAccessToken: string | null = null;
let sessionRefresher: (() => Promise<string | null>) | null = null;

export const setAuthTokenGetter = (getter: (() => string | null) | null) => {
  tokenGetter = getter;
};

/** Survives Vite HMR module resets so API calls keep working until useAuth re-inits. */
export const setCachedAccessToken = (token: string | null) => {
  cachedAccessToken = token;
};

export const setSessionRefresher = (refresher: (() => Promise<string | null>) | null) => {
  sessionRefresher = refresher;
};

export const getAuthToken = (): string | null => tokenGetter?.() || cachedAccessToken || null;

const buildRequestInit = (init: RequestInit | undefined, token: string | null): RequestInit => {
  const headers = new Headers(init?.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (init?.body && !headers.has('Content-Type') && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  if (!headers.has('Cache-Control')) {
    headers.set('Cache-Control', 'no-cache');
  }
  return { ...init, headers, cache: init?.cache ?? 'no-store' };
};

export const apiFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  let token = getAuthToken();
  let response = await fetch(input, buildRequestInit(init, token));

  if (response.status === 401 && sessionRefresher) {
    const refreshedToken = await sessionRefresher();
    if (refreshedToken) {
      token = refreshedToken;
      response = await fetch(input, buildRequestInit(init, token));
    } else {
      setCachedAccessToken(null);
    }
  }

  return response;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public payload?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const readApiError = async (response: Response): Promise<string> => {
  try {
    const data = await response.json();
    return (data as { error?: string }).error || response.statusText;
  } catch {
    return response.statusText;
  }
};
