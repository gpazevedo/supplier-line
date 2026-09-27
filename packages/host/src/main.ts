import { fileURLToPath } from 'node:url';
import { localTraceWriter } from 'traces/src/index.js';
import { createHostServer } from './server.js';
import { attachSessions } from './sessions.js';
import { createSonicClient } from './sonic/session.js';

const port = Number(process.env.PORT ?? 8080);
const traceDir =
  process.env.TRACE_DIR ?? fileURLToPath(new URL('../../../traces/', import.meta.url));

const server = createHostServer();
attachSessions(server, { client: createSonicClient(), writer: localTraceWriter(traceDir) });
server.listen(port, () => console.log(`host listening on :${port}, traces in ${traceDir}`));
