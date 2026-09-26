import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHostServer } from './server.js';

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
