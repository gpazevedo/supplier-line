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

describe('POST /api/connect/start', () => {
  it('returns 503 when Connect is not configured', async () => {
    const res = await fetch(`${base}/api/connect/start`, { method: 'POST' });
    expect(res.status).toBe(503);
  });

  it('starts a WebRTC contact and returns what the calling page needs to join', async () => {
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
    const connect: ConnectDeps = {
      client: fakeClient,
      instanceId: 'instance-1',
      contactFlowId: 'flow-1',
    };
    const withConnect = createHostServer({ connect });
    await new Promise<void>((resolve) => withConnect.listen(0, resolve));
    const port = (withConnect.address() as AddressInfo).port;

    const res = await fetch(`http://127.0.0.1:${port}/api/connect/start`, { method: 'POST' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      connectionData,
      contactId: 'contact-1',
      participantId: 'participant-1',
      participantToken: 'participant-token',
    });
    expect(calls).toEqual([
      { InstanceId: 'instance-1', ContactFlowId: 'flow-1', ParticipantDetails: expect.any(Object) },
    ]);
    await new Promise<void>((resolve) => withConnect.close(() => resolve()));
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
    const withConnect = createHostServer({ connect });
    await new Promise<void>((resolve) => withConnect.listen(0, resolve));
    const port = (withConnect.address() as AddressInfo).port;

    const res = await fetch(`http://127.0.0.1:${port}/api/connect/start`, { method: 'POST' });
    expect(res.status).toBe(502);
    await new Promise<void>((resolve) => withConnect.close(() => resolve()));
  });
});
