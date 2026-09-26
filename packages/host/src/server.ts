import { createServer, type Server } from 'node:http';

/** Minimal HTTP server: `GET /health` returns 200, everything else 404. */
export function createHostServer(): Server {
  return createServer((req, res) => {
    const healthy = req.method === 'GET' && req.url === '/health';
    res.writeHead(healthy ? 200 : 404).end(healthy ? 'ok' : undefined);
  });
}
