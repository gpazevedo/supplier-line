import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { StartWebRTCContactCommand, type ConnectClient } from '@aws-sdk/client-connect';

/** Amazon Connect instance and contact flow the demo calling page joins through (S17). */
export interface ConnectDeps {
  client: ConnectClient;
  instanceId: string;
  contactFlowId: string;
}

export interface HostServerDeps {
  connect?: ConnectDeps;
}

/** Minimal HTTP server: `GET /health`, `POST /api/connect/start`, everything else 404. */
export function createHostServer(deps: HostServerDeps = {}): Server {
  return createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200).end('ok');
      return;
    }
    if (req.method === 'POST' && req.url === '/api/connect/start') {
      void startConnectContact(res, deps.connect);
      return;
    }
    res.writeHead(404).end();
  });
}

function sendJson(res: ServerResponse<IncomingMessage>, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

/**
 * Starts an Amazon Connect WebRTC contact and returns what the calling page (S18) needs to join
 * with the Amazon Chime SDK: the meeting and attendee, the contact and participant IDs, and the
 * participant token for `CreateParticipantConnection`.
 */
async function startConnectContact(
  res: ServerResponse<IncomingMessage>,
  connect: ConnectDeps | undefined
): Promise<void> {
  if (!connect) return sendJson(res, 503, { error: 'Connect calling is not configured' });
  try {
    const result = await connect.client.send(
      new StartWebRTCContactCommand({
        InstanceId: connect.instanceId,
        ContactFlowId: connect.contactFlowId,
        ParticipantDetails: { DisplayName: 'Caller' },
      })
    );
    sendJson(res, 200, {
      connectionData: result.ConnectionData,
      contactId: result.ContactId,
      participantId: result.ParticipantId,
      participantToken: result.ParticipantToken,
    });
  } catch (error) {
    console.error('connect/start failed', error);
    sendJson(res, 502, { error: 'Could not start the call' });
  }
}
