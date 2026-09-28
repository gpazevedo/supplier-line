/** Shape of `POST /api/connect/start`'s response (host/src/server.ts), matching `StartWebRTCContact`. */
export interface ConnectionData {
  Meeting: unknown;
  Attendee: unknown;
}

export interface ConnectStartResult {
  connectionData: ConnectionData;
  contactId: string;
  participantId: string;
  participantToken: string;
}

/**
 * Starts a Connect WebRTC contact through the host; throws with the server's own message on
 * failure. The access code goes in the JSON body, not a URL query, so it doesn't end up in logs.
 */
export async function startConnectCall(
  code: string,
  fetchImpl: typeof fetch = fetch
): Promise<ConnectStartResult> {
  const res = await fetchImpl('/api/connect/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Could not start the call (${res.status})`);
  return body as ConnectStartResult;
}
