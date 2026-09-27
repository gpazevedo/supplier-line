import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';

/**
 * Drives the built pages in a real, headless browser (Chrome via Playwright's `channel: 'chrome'`,
 * so no separate browser download is needed) and runs axe-core against them. Both pages are exercised
 * without a live host: the viewer is fed sample trace files directly, and the softphone's hardware and
 * network APIs are stubbed so it reaches a simulated in-call state.
 */

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const webRoot = fileURLToPath(new URL('..', import.meta.url));
const samplesDir = join(webRoot, '../traces/samples');

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** A real browser plus a dev server is slower to spin up than vitest's 5s default, especially under load. */
const TEST_TIMEOUT_MS = 30_000;

let server: ViteDevServer;
let browser: Browser;
let baseUrl: string;

beforeAll(async () => {
  server = await createServer({ root: webRoot, server: { port: 0 }, logLevel: 'silent' });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string')
    throw new Error('dev server did not bind a TCP port');
  baseUrl = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ channel: 'chrome' });
}, TEST_TIMEOUT_MS);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

interface AxeResults {
  violations: { id: string; help: string; nodes: { target: string[] }[] }[];
}

async function axeCheck(page: Page): Promise<AxeResults> {
  await page.addScriptTag({ content: axeSource });
  return page.evaluate(
    (tags) =>
      (window as unknown as { axe: { run: typeof import('axe-core').run } }).axe.run(document, {
        runOnly: { type: 'tag', values: tags },
      }),
    WCAG_TAGS
  ) as Promise<AxeResults>;
}

function describeViolations(results: AxeResults): string {
  return results.violations
    .map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`)
    .join('\n');
}

describe('trace viewer accessibility', () => {
  it(
    'has no WCAG 2.2 AA violations with every sample trace loaded',
    async () => {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/index.html`);
      const files = readdirSync(samplesDir)
        .filter((name) => name.endsWith('.json'))
        .map((name) => join(samplesDir, name));
      await page.locator('input[type="file"]').setInputFiles(files);
      await page.locator('.output .turn').first().waitFor();

      const results = await axeCheck(page);
      expect(results.violations, describeViolations(results)).toEqual([]);
      await page.close();
    },
    TEST_TIMEOUT_MS
  );
});

describe('softphone accessibility', () => {
  it(
    'has no WCAG 2.2 AA violations idle',
    async () => {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/softphone.html`);
      await page.getByRole('button', { name: 'Call' }).waitFor();

      const results = await axeCheck(page);
      expect(results.violations, describeViolations(results)).toEqual([]);
      await page.close();
    },
    TEST_TIMEOUT_MS
  );

  it(
    'has no WCAG 2.2 AA violations in a simulated call with transcript lines',
    async () => {
      const page = await browser.newPage();
      await page.addInitScript(stubCallHardware);
      await page.goto(`${baseUrl}/softphone.html`);
      await page.getByRole('button', { name: 'Call' }).click();
      await page.getByRole('button', { name: 'Hang up' }).waitFor();
      await page.evaluate(() => {
        const socket = (
          window as unknown as { __wsInstances: { onmessage?: (e: { data: string }) => void }[] }
        ).__wsInstances.at(-1);
        const send = (message: unknown) => socket?.onmessage?.({ data: JSON.stringify(message) });
        send({ type: 'transcript', role: 'caller', text: 'What is the status of PO 48217?' });
        send({
          type: 'transcript',
          role: 'assistant',
          text: 'Purchase order 4 8 2 1 7 is shipped and due on March third.',
        });
      });
      await page.locator('.transcript li').nth(1).waitFor();

      const results = await axeCheck(page);
      expect(results.violations, describeViolations(results)).toEqual([]);
      await page.close();
    },
    TEST_TIMEOUT_MS
  );
});

/* eslint-disable @typescript-eslint/no-empty-function -- test doubles that intentionally do nothing */
/** Stubs getUserMedia, AudioContext/AudioWorkletNode and WebSocket so `call()` runs without real hardware. */
function stubCallHardware(): void {
  class FakeWebSocket {
    static readonly OPEN = 1;
    readyState = FakeWebSocket.OPEN;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    binaryType = '';
    constructor(readonly url: string) {
      const instances = ((window as unknown as { __wsInstances: FakeWebSocket[] }).__wsInstances ??=
        []);
      instances.push(this);
    }
    send(): void {}
    close(): void {
      this.readyState = 3;
      this.onclose?.();
    }
  }
  (window as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;

  // Assigning a fresh object to navigator.mediaDevices is a no-op (it's a read-only accessor), so
  // getUserMedia is overridden as an own property on the real object instead.
  navigator.mediaDevices.getUserMedia = (async () => ({
    getTracks: () => [{ stop() {} }],
  })) as typeof navigator.mediaDevices.getUserMedia;

  class FakeAudioWorkletNode {
    port = { postMessage() {}, onmessage: null };
    connect(): void {}
  }
  (window as unknown as { AudioWorkletNode: unknown }).AudioWorkletNode = FakeAudioWorkletNode;

  class FakeAudioContext {
    audioWorklet = { addModule: async () => {} };
    destination = {};
    createMediaStreamSource() {
      return { connect() {} };
    }
  }
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
}
