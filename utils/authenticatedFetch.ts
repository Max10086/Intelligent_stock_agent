let tokenGetter: (() => string | null) | null = null;

export const setAuthTokenGetter = (getter: (() => string | null) | null) => {
  tokenGetter = getter;
};

export const getAuthToken = (): string | null => tokenGetter?.() || null;

export const apiFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const headers = new Headers(init?.headers);
  const token = getAuthToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (init?.body && !headers.has('Content-Type') && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(input, { ...init, headers });
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
