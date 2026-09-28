import type { AddressInfo } from 'node:net';
import type { ConnectClient } from '@aws-sdk/client-connect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHostServer, type ConnectDeps } from './server.js';

const server = createHostServer();
let base: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

it('GET /health returns 200', async () => {
  expect((await fetch(`${base}/health`)).status).toBe(200);
});

it('unknown path returns 404', async () => {
  expect((await fetch(`${base}/nope`)).status).toBe(404);
});

const ACCESS_CODE = 'let-me-in';

/** A `ConnectDeps` whose client records every command it's sent, for asserting it was never called. */
function recordingConnect(): { connect: ConnectDeps; calls: unknown[] } {
  const calls: unknown[] = [];
  const connectionData = {
    Attendee: { AttendeeId: 'a-1', JoinToken: 'token' },
    Meeting: { MeetingId: 'm-1' },
  };
  const fakeClient = {
    send: async (command: { input: unknown }) => {
      calls.push(command.input);
      return {
        ConnectionData: connectionData,
        ContactId: 'contact-1',
        ParticipantId: 'participant-1',
        ParticipantToken: 'participant-token',
      };
    },
  } as unknown as ConnectClient;
  return {
    calls,
    connect: { client: fakeClient, instanceId: 'instance-1', contactFlowId: 'flow-1' },
  };
}

async function post(port: number, body?: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/api/connect/start`, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function withServer<T>(
  deps: Parameters<typeof createHostServer>[0],
  run: (port: number) => Promise<T>
): Promise<T> {
  const server = createHostServer(deps);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  try {
    return await run((server.address() as AddressInfo).port);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('POST /api/connect/start', () => {
  it('returns 401 with no Connect call when the access code is missing', async () => {
    const { connect, calls } = recordingConnect();
    await withServer({ connect, accessCode: ACCESS_CODE }, async (port) => {
      const res = await post(port);
      expect(res.status).toBe(401);
      expect(calls).toEqual([]);
    });
  });

  it('returns 401 with no Connect call when the access code is wrong', async () => {
    const { connect, calls } = recordingConnect();
    await withServer({ connect, accessCode: ACCESS_CODE }, async (port) => {
      const res = await post(port, { code: 'nope' });
      expect(res.status).toBe(401);
      expect(calls).toEqual([]);
    });
  });

  it('returns 401 for a JSON body that is not an object, and keeps serving', async () => {
    const { connect, calls } = recordingConnect();
    await withServer({ connect, accessCode: ACCESS_CODE }, async (port) => {
      for (const body of [null, 42, 'code', [ACCESS_CODE]]) {
        expect((await post(port, body)).status, JSON.stringify(body)).toBe(401);
      }
      expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
      expect(calls).toEqual([]);
    });
  });

  it('returns 413 for a body over 4 KiB, before checking the code', async () => {
    const { connect, calls } = recordingConnect();
    await withServer({ connect, accessCode: ACCESS_CODE }, async (port) => {
      const res = await post(port, { code: ACCESS_CODE, padding: 'x'.repeat(5000) });
      expect(res.status).toBe(413);
      expect(calls).toEqual([]);
    });
  });

  it('returns 503 when Connect is not configured, even with the right code', async () => {
    await withServer({ accessCode: ACCESS_CODE }, async (port) => {
      const res = await post(port, { code: ACCESS_CODE });
      expect(res.status).toBe(503);
    });
  });

  it('starts a WebRTC contact and returns what the calling page needs to join', async () => {
    const { connect, calls } = recordingConnect();
    await withServer({ connect, accessCode: ACCESS_CODE }, async (port) => {
      const res = await post(port, { code: ACCESS_CODE });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({
        connectionData: {
          Attendee: { AttendeeId: 'a-1', JoinToken: 'token' },
          Meeting: { MeetingId: 'm-1' },
        },
        contactId: 'contact-1',
        participantId: 'participant-1',
        participantToken: 'participant-token',
      });
      expect(calls).toEqual([
        {
          InstanceId: 'instance-1',
          ContactFlowId: 'flow-1',
          ParticipantDetails: expect.any(Object),
        },
      ]);
    });
  });

  it('returns 502 when StartWebRTCContact fails', async () => {
    const fakeClient = {
      send: async () => {
        throw new Error('AccessDeniedException');
      },
    } as unknown as ConnectClient;
    const connect: ConnectDeps = {
      client: fakeClient,
      instanceId: 'instance-1',
      contactFlowId: 'flow-1',
    };
    await withServer({ connect, accessCode: ACCESS_CODE }, async (port) => {
      const res = await post(port, { code: ACCESS_CODE });
      expect(res.status).toBe(502);
    });
  });
});
