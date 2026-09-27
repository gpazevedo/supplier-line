import { fileURLToPath } from 'node:url';
import { localTraceWriter } from 'traces/src/index.js';
import { createHostServer } from './server.js';
import { attachSessions } from './sessions.js';
import { createSonicClient } from './sonic/session.js';

const port = Number(process.env.PORT ?? 8080);
const traceDir =
  process.env.TRACE_DIR ?? fileURLToPath(new URL('../../../traces/', import.meta.url));
const rotation = {
  thresholdMs: Number(process.env.ROTATE_AFTER_S ?? 360) * 1000,
  bufferMs: 3000,
  audioStartTimeoutMs: 20_000,
  handoverTimeoutMs: 30_000,
};

const server = createHostServer();
attachSessions(server, {
  client: createSonicClient(),
  writer: localTraceWriter(traceDir),
  rotation,
});
server.listen(port, () =>
  console.log(
    `host listening on :${port}, traces in ${traceDir}, rotation after ${rotation.thresholdMs / 1000} s`
  )
);
