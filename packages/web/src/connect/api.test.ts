import { describe, expect, it } from 'vitest';
import { startConnectCall } from './api.js';

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe('startConnectCall', () => {
  it('returns the connection details on success', async () => {
    const body = {
      connectionData: { Meeting: {}, Attendee: {} },
      contactId: 'contact-1',
      participantId: 'participant-1',
      participantToken: 'participant-token',
    };
    await expect(startConnectCall(fakeFetch(200, body))).resolves.toEqual(body);
  });

  it('throws the server error message when the host rejects the request', async () => {
    await expect(
      startConnectCall(fakeFetch(503, { error: 'Connect calling is not configured' }))
    ).rejects.toThrow('Connect calling is not configured');
  });

  it('falls back to a generic message when the body has no error field', async () => {
    await expect(startConnectCall(fakeFetch(502, {}))).rejects.toThrow('502');
  });
});
