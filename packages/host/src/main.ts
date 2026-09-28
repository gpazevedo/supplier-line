import { ConnectClient } from '@aws-sdk/client-connect';
import { loadFixedPhrases } from './phrases/fixed.js';
import { loadSessionNotices } from './phrases/notices.js';
import { attachSessions } from './sessions.js';
import { createHostServer, type ConnectDeps } from './server.js';
import { createSonicClient } from './sonic/session.js';
import { traceWriter } from './trace-writer.js';

const port = Number(process.env.PORT ?? 8080);
const rotation = {
  thresholdMs: Number(process.env.ROTATE_AFTER_S ?? 360) * 1000,
  bufferMs: 3000,
  audioStartTimeoutMs: 20_000,
  handoverTimeoutMs: 30_000,
};

const accessCode = process.env.DEMO_ACCESS_CODE;
if (!accessCode) throw new Error('DEMO_ACCESS_CODE must be set (locally, or from SSM in AWS)');

function connectDeps(): ConnectDeps | undefined {
  const instanceId = process.env.CONNECT_INSTANCE_ID;
  const contactFlowId = process.env.CONNECT_CONTACT_FLOW_ID;
  if (!instanceId || !contactFlowId) return undefined;
  return { client: new ConnectClient({ region: 'us-east-1' }), instanceId, contactFlowId };
}

const server = createHostServer({ connect: connectDeps(), accessCode });
attachSessions(server, {
  client: createSonicClient(),
  writer: traceWriter(),
  rotation,
  accessCode,
  notices: loadSessionNotices(),
  phrases: loadFixedPhrases(),
});
server.listen(port, () =>
  console.log(
    `host listening on :${port}, traces to ${process.env.TRACES_BUCKET ?? process.env.TRACE_DIR ?? 'traces/'}, rotation after ${rotation.thresholdMs / 1000} s`
  )
);
