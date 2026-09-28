import { describe, expect, it } from 'vitest';
import { startConnectCall } from './api.js';

function fakeFetch(
  status: number,
  body: unknown
): { fetch: typeof fetch; requests: [string, RequestInit | undefined][] } {
  const requests: [string, RequestInit | undefined][] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    requests.push([url, init]);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  }) as unknown as typeof globalThis.fetch;
  return { fetch, requests };
}

describe('startConnectCall', () => {
  it('sends the access code in the JSON body, not the URL', async () => {
    const { fetch, requests } = fakeFetch(200, {
      connectionData: { Meeting: {}, Attendee: {} },
      contactId: 'contact-1',
      participantId: 'participant-1',
      participantToken: 'participant-token',
    });
    await startConnectCall('let-me-in', fetch);

    expect(requests).toHaveLength(1);
    const [url, init] = requests[0];
    expect(url).toBe('/api/connect/start');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ code: 'let-me-in' });
  });

  it('returns the connection details on success', async () => {
    const body = {
      connectionData: { Meeting: {}, Attendee: {} },
      contactId: 'contact-1',
      participantId: 'participant-1',
      participantToken: 'participant-token',
    };
    await expect(startConnectCall('let-me-in', fakeFetch(200, body).fetch)).resolves.toEqual(body);
  });

  it('throws the server error message when the host rejects the request', async () => {
    await expect(
      startConnectCall('wrong', fakeFetch(401, { error: 'wrong access code' }).fetch)
    ).rejects.toThrow('wrong access code');
  });

  it('falls back to a generic message when the body has no error field', async () => {
    await expect(startConnectCall('let-me-in', fakeFetch(502, {}).fetch)).rejects.toThrow('502');
  });
});
