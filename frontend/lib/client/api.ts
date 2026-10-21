export class ApiClientError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

/** fetch() wrapper: sends cookies, parses JSON, throws a readable error. status 0 = network failure. */
export async function api<T>(url: string, init?: Omit<RequestInit, 'body'> & { body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      credentials: 'same-origin',
      ...init,
      headers: { 'Content-Type': 'application/json' },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiClientError('Cannot reach the server. Check your connection.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiClientError(data.error ?? 'Request failed', res.status);
  return data as T;
}
