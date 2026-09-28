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
  /** Checked against the JSON body's `code` field on `/api/connect/start`; wrong or missing is a 401. */
  accessCode?: string;
}

/** Minimal HTTP server: `GET /health`, `POST /api/connect/start`, everything else 404. */
export function createHostServer(deps: HostServerDeps = {}): Server {
  return createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200).end('ok');
      return;
    }
    if (req.method === 'POST' && req.url === '/api/connect/start') {
      void startConnectContact(req, res, deps);
      return;
    }
    res.writeHead(404).end();
  });
}

function sendJson(res: ServerResponse<IncomingMessage>, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

/** Reads the request body as JSON; a missing or malformed body reads as `{}`. */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

/**
 * Starts an Amazon Connect WebRTC contact and returns what the calling page (S18) needs to join
 * with the Amazon Chime SDK: the meeting and attendee, the contact and participant IDs, and the
 * participant token for `CreateParticipantConnection`. Requires the same access code as `/ws`
 * (S17), sent in the JSON body rather than a URL query so it doesn't end up in access logs; wrong
 * or missing is a 401, before `StartWebRTCContact` is ever called. A Connect call isn't counted
 * toward `/ws`'s 2-concurrent-sessions limit: `StartWebRTCContact` is a single request/response,
 * with no ongoing connection to this host that a session count could track.
 */
async function startConnectContact(
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>,
  { connect, accessCode }: HostServerDeps
): Promise<void> {
  const body = await readJsonBody(req);
  const code = typeof body.code === 'string' ? body.code : null;
  if (accessCode !== undefined) {
    if (code === null) return sendJson(res, 401, { error: 'missing access code' });
    if (code !== accessCode) return sendJson(res, 401, { error: 'wrong access code' });
  }
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
