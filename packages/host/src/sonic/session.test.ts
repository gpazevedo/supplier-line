import { setTimeout as wait } from 'node:timers/promises';
import type { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { describe, expect, it } from 'vitest';
import type { FixedPhrases } from '../phrases/fixed.js';
import { AsyncQueue } from './queue.js';
import { SonicSession, type SessionListener } from './session.js';

type Body = Record<string, unknown>;
interface Chunk {
  chunk: { bytes: Uint8Array };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const ROTATION = {
  thresholdMs: 10_000_000,
  bufferMs: 3000,
  audioStartTimeoutMs: 20_000,
  handoverTimeoutMs: 30_000,
};

/**
 * A single-connection fake Sonic stream: `emit` pushes a synthetic output event as Sonic would,
 * and `input` records every event the host sent in, decoded, in order.
 */
function scriptedClient() {
  let output: AsyncQueue<Chunk>;
  const opened = Promise.withResolvers<undefined>();
  const input: Body[] = [];
  const client = {
    send: (command: { input: { body: AsyncIterable<Chunk> } }) => {
      output = new AsyncQueue<Chunk>();
      opened.resolve(undefined);
      void (async () => {
        for await (const chunk of command.input.body) {
          const { event } = JSON.parse(decoder.decode(chunk.chunk.bytes)) as { event: Body };
          input.push(event);
        }
      })();
      return Promise.resolve({ body: output });
    },
  } as unknown as BedrockRuntimeClient;
  return {
    client,
    opened: opened.promise,
    input,
    emit: (event: Body) =>
      output.push({ chunk: { bytes: encoder.encode(JSON.stringify({ event })) } }),
  };
}

/** A caller's FINAL transcript segment for a fresh content block. */
function callerSaid(contentId: string, content: string): Body[] {
  return [
    { contentStart: { contentId, role: 'USER', additionalModelFields: '{"stage":"FINAL"}' } },
    { textOutput: { contentId, content } },
  ];
}

function fakePhrases(): FixedPhrases {
  return {
    'FH-01': { text: "Sorry, this line can't take your call right now.", pcm: Buffer.alloc(200) },
    'FH-03': { text: 'One moment.', pcm: Buffer.alloc(50) },
    'FH-10': { text: 'Still checking, one moment.', pcm: Buffer.alloc(60) },
  };
}

function fakeListener() {
  const audio: { pcm: Buffer; turn: number | undefined }[] = [];
  const transcripts: { role: string; text: string }[] = [];
  const listener: SessionListener = {
    onAudio: (pcm, turn) => audio.push({ pcm, turn }),
    onInterrupted: () => undefined,
    onTranscript: (role, text) => transcripts.push({ role, text }),
  };
  return { listener, audio, transcripts };
}

describe('SonicSession failure behaviours', () => {
  it('FH-01: plays the fallback and closes cleanly when the stream will not open', async () => {
    const client = {
      send: () => Promise.reject(new Error('boom')),
    } as unknown as BedrockRuntimeClient;
    const phrases = fakePhrases();
    const { listener, audio } = fakeListener();
    const session = new SonicSession(client, listener, ROTATION, { phrases });

    await session.run();

    expect(audio).toEqual([{ pcm: phrases['FH-01'].pcm, turn: 0 }]);
    const trace = session.trace();
    expect(trace.events).toEqual([{ fh: { id: 'FH-01' }, at_ms: expect.any(Number) }]);
    expect(trace.turns).toEqual([
      expect.objectContaining({ index: 0, assistant: { final_text: phrases['FH-01'].text } }),
    ]);
  });

  it('FH-01: a later error on the same connection is not also reported as a hard failure', async () => {
    const client = {
      send: () => Promise.reject(new Error('boom')),
    } as unknown as BedrockRuntimeClient;
    const { listener } = fakeListener();
    const session = new SonicSession(client, listener, ROTATION, { phrases: fakePhrases() });
    await expect(session.run()).resolves.toBeUndefined();
  });

  it('FH-03: plays the filler once no agent audio has started within the stall window', async () => {
    const sc = scriptedClient();
    const phrases = fakePhrases();
    const { listener, audio } = fakeListener();
    const session = new SonicSession(sc.client, listener, ROTATION, {
      phrases,
      fillerStallMs: 30,
      toolTimeoutMs: 10_000,
    });
    await sc.opened;

    callerSaid('u1', 'po dash one oh four eight two').forEach(sc.emit);
    await wait(80);

    expect(audio).toEqual([{ pcm: phrases['FH-03'].pcm, turn: 0 }]);
    const trace = session.trace();
    expect(trace.events).toContainEqual({
      fh: { id: 'FH-03' },
      at_ms: expect.any(Number),
      turn: 0,
    });
    expect(trace.turns[0]?.filler).toEqual({ played: true });
    session.close();
  });

  it('FH-03: never fires once agent audio starts before the stall window', async () => {
    const sc = scriptedClient();
    const phrases = fakePhrases();
    const { listener, audio } = fakeListener();
    const session = new SonicSession(sc.client, listener, ROTATION, {
      phrases,
      fillerStallMs: 30,
      toolTimeoutMs: 10_000,
    });
    await sc.opened;

    callerSaid('u1', 'po dash one oh four eight two').forEach(sc.emit);
    await wait(10);
    sc.emit({ audioOutput: { contentId: 'a1', content: Buffer.alloc(480).toString('base64') } });
    await wait(80);

    expect(audio.some((a) => a.pcm.equals(phrases['FH-03'].pcm))).toBe(false);
    session.close();
  });

  it('FH-10: fillers, retries once, discards the stale first attempt, and sends one toolResult', async () => {
    const sc = scriptedClient();
    const phrases = fakePhrases();
    const { listener, audio } = fakeListener();
    const session = new SonicSession(sc.client, listener, ROTATION, {
      phrases,
      toolTimeoutMs: 50,
      fillerStallMs: 10_000,
      fault: { toolDelayMs: 300 },
    });
    await sc.opened;

    callerSaid('u1', 'po dash one oh four eight two').forEach(sc.emit);
    sc.emit({
      toolUse: {
        toolName: 'get_po_status',
        toolUseId: 't1',
        content: JSON.stringify({ po_code: 'PO-10482' }),
      },
    });
    await wait(400); // past the 50 ms timeout, the fast (undelayed) retry, and the stale first attempt

    expect(audio.some((a) => a.pcm.equals(phrases['FH-10'].pcm))).toBe(true);
    const trace = session.trace();
    expect(trace.events).toContainEqual({
      fh: { id: 'FH-10' },
      at_ms: expect.any(Number),
      turn: 0,
    });

    const toolResults = sc.input.filter((e) => 'toolResult' in e);
    expect(toolResults).toHaveLength(1);
    const content = JSON.parse(String((toolResults[0]?.toolResult as Body).content)) as {
      ok: boolean;
    };
    expect(content.ok).toBe(true); // the undelayed retry succeeded
    session.close();
  });
});
