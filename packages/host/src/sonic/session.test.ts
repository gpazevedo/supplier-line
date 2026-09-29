import { setTimeout as wait } from 'node:timers/promises';
import type { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { describe, expect, it } from 'vitest';
import type { FixedPhrases } from '../phrases/fixed.js';
import { LOOK_UP_FIRST, SPEAK_NOW } from './interventions.js';
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

/** A caller's FINAL transcript segment for a fresh content block, still mid-speech. */
function callerSegment(contentId: string, content: string): Body[] {
  return [
    { contentStart: { contentId, role: 'USER', additionalModelFields: '{"stage":"FINAL"}' } },
    { textOutput: { contentId, content } },
  ];
}

/** A caller's whole utterance: its transcript, then Sonic detecting the end of speech. */
function callerSaid(contentId: string, content: string): Body[] {
  return [...callerSegment(contentId, content), { userSpeechEnd: {} }];
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
  const ready: number[] = [];
  const listener: SessionListener = {
    onAudio: (pcm, turn) => audio.push({ pcm, turn }),
    onInterrupted: () => undefined,
    onTranscript: (role, text) => transcripts.push({ role, text }),
    onReady: () => ready.push(Date.now()),
  };
  return { listener, audio, transcripts, ready };
}

describe('SonicSession readiness', () => {
  it('drops caller audio until Sonic sends its first event, then reports ready once', async () => {
    // A late-opening stream used to get the caller's queued audio as a backlog; Sonic consumed it
    // faster than real time, its playback clock ran ahead of the caller's, and a barge-in near the
    // end of an answer was taken as a new turn with no INTERRUPTED (live barge-in failure).
    const sc = scriptedClient();
    const { listener, ready } = fakeListener();
    const session = new SonicSession(sc.client, listener, ROTATION, { phrases: fakePhrases() });
    await sc.opened;
    const audioIn = () => sc.input.filter((event) => 'audioInput' in event).length;

    session.sendAudio(Buffer.alloc(1024));
    await wait(10);
    expect(audioIn()).toBe(0);
    expect(ready).toHaveLength(0);

    sc.emit({ usageEvent: {} });
    sc.emit({ usageEvent: {} });
    await wait(10);
    session.sendAudio(Buffer.alloc(1024));
    await wait(10);
    expect(audioIn()).toBe(1);
    expect(ready).toHaveLength(1);
    session.close();
  });
});

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

  it('FH-03: never fires in a pause mid-code, before Sonic detects the end of speech', async () => {
    const sc = scriptedClient();
    const phrases = fakePhrases();
    const { listener, audio } = fakeListener();
    const session = new SonicSession(sc.client, listener, ROTATION, {
      phrases,
      fillerStallMs: 30,
      toolTimeoutMs: 10_000,
    });
    await sc.opened;

    sc.emit({ userSpeechStart: {} });
    callerSegment('u1', 'what is the status of p o one').forEach(sc.emit);
    await wait(80);
    expect(audio).toEqual([]);

    callerSegment('u2', 'oh four eight two').forEach(sc.emit);
    sc.emit({ userSpeechEnd: {} });
    await wait(80);
    expect(audio).toEqual([{ pcm: phrases['FH-03'].pcm, turn: 0 }]);
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

  it('FH-03: a pending filler timer never fires once the session has been closed', async () => {
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
    session.close(); // the caller hung up before the stall window elapsed
    await wait(80); // past what would have been the stall window

    expect(audio.some((a) => a.pcm.equals(phrases['FH-03'].pcm))).toBe(false);
  });

  it('FH-03 fault: holds real agent audio so the stall reliably fires even when Sonic speaks immediately', async () => {
    // Reproduces the live bug: with only a tool-call delay, Sonic's own "Let me check that." audio
    // (unrelated to the delayed tool call) started well inside the 1.5 s stall window, so FH-03
    // never fired. Holding the real audio back guarantees the stall regardless of what Sonic says.
    const sc = scriptedClient();
    const phrases = fakePhrases();
    const { listener, audio } = fakeListener();
    const session = new SonicSession(sc.client, listener, ROTATION, {
      phrases,
      fillerStallMs: 30,
      toolTimeoutMs: 10_000,
      fault: { holdAudioMs: 150 },
    });
    await sc.opened;

    callerSaid('u1', 'po dash one oh four eight two').forEach(sc.emit);
    await wait(10);
    const realAudio = Buffer.alloc(480, 7);
    sc.emit({ audioOutput: { contentId: 'a1', content: realAudio.toString('base64') } }); // well inside the 150 ms hold
    await wait(250); // past both the 30 ms stall window and the 150 ms hold
    expect(audio.map((a) => a.pcm)).toEqual([phrases['FH-03'].pcm, realAudio]); // filler, then the held audio
    const trace = session.trace();
    expect(trace.events).toContainEqual({
      fh: { id: 'FH-03' },
      at_ms: expect.any(Number),
      turn: 0,
    });
    session.close();
  });

  it('FH-03 fault: the hold survives a code read digit by digit across several caller segments', async () => {
    // Reproduces a second live gap: the fault held audio only from the caller's *first* segment,
    // so a code read in pieces ("...one?" / "zero four?" / "eight two.") let the hold lapse and
    // release (nothing yet) before the caller even finished, well before Sonic ever spoke.
    const sc = scriptedClient();
    const phrases = fakePhrases();
    const { listener, audio } = fakeListener();
    const session = new SonicSession(sc.client, listener, ROTATION, {
      phrases,
      fillerStallMs: 10_000,
      toolTimeoutMs: 10_000,
      fault: { holdAudioMs: 150 },
    });
    await sc.opened;

    callerSaid('u1', 'po dash one').forEach(sc.emit);
    await wait(40); // less than the 150 ms hold: the caller keeps reading before it lapses
    callerSaid('u2', 'oh four').forEach(sc.emit);
    await wait(40);
    callerSaid('u3', 'eight two').forEach(sc.emit);
    await wait(40); // still less than 150 ms since the last segment: the hold is still extended

    const realAudio = Buffer.alloc(480, 9);
    sc.emit({ audioOutput: { contentId: 'a1', content: realAudio.toString('base64') } });
    await wait(200); // past the 150 ms hold from the last caller segment

    expect(audio).toEqual([{ pcm: realAudio, turn: 0 }]); // held, then released once quiet
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

/** An agent text segment at `stage`, as Sonic streams it. */
function agentSaid(contentId: string, stage: 'SPECULATIVE' | 'FINAL', content: string): Body[] {
  const fields = `{"generationStage":"${stage}"}`;
  return [
    { contentStart: { contentId, role: 'ASSISTANT', type: 'TEXT', additionalModelFields: fields } },
    { textOutput: { contentId, content } },
  ];
}

const sentTexts = (input: Body[]) =>
  input.flatMap((event) =>
    'textInput' in event ? [String((event.textInput as Body).content)] : []
  );

describe('SonicSession interventions', () => {
  const PO_ANSWER = 'Purchase order one zero four eight two from Summit Fasteners has shipped.';
  const RENDERING_10482 = `${PO_ANSWER} The amount is forty-five thousand two hundred sixteen euros and eighteen cents. It was ordered on October fourth, twenty twenty-six, and delivery is due on October twenty-fourth, twenty twenty-six.`;

  it('B: mutes an answer that speaks PO data with no lookup and asks Sonic to look it up', async () => {
    const sc = scriptedClient();
    const { listener, audio } = fakeListener();
    const flushed: (number | undefined)[] = [];
    listener.onInterrupted = (turn) => flushed.push(turn);
    const session = new SonicSession(sc.client, listener, ROTATION, {
      phrases: fakePhrases(),
      fillerStallMs: 10_000,
    });
    await sc.opened;
    sc.emit({ usageEvent: {} });
    callerSaid('u1', 'status of p o one zero four eight two').forEach(sc.emit);
    agentSaid('s1', 'SPECULATIVE', PO_ANSWER).forEach(sc.emit);
    sc.emit({ audioOutput: { contentId: 'a1', content: Buffer.alloc(480).toString('base64') } });
    agentSaid('f1', 'FINAL', PO_ANSWER).forEach(sc.emit);
    await wait(20);

    expect(audio).toEqual([]);
    expect(flushed).toEqual([0]);
    expect(sentTexts(sc.input).at(-1)).toBe(LOOK_UP_FIRST);
    const [turn] = session.trace().turns;
    expect(turn.interventions).toEqual(['blocked-answer']);
    expect(turn.assistant.final_text).toBe('');
    session.close();
  });

  it('B: the caller hears, and the trace records, only the grounded answer (live turn 14)', async () => {
    // Sonic answered from memory, was blocked, looked the order up and spoke the rendering; the
    // blocked sentence's FINAL never came. final_text and the transcript lost sentence one and
    // repeated sentence three, while the audio was right.
    const sc = scriptedClient();
    const { listener, audio, transcripts } = fakeListener();
    const session = new SonicSession(sc.client, listener, ROTATION, {
      phrases: fakePhrases(),
      fillerStallMs: 10_000,
    });
    const [one, two, three] = RENDERING_10482.split(/(?<=\.) /);
    const say = (id: string, text: string) => {
      agentSaid(`s${id}`, 'SPECULATIVE', text).forEach(sc.emit);
      sc.emit({
        audioOutput: { contentId: `a${id}`, content: Buffer.alloc(48).toString('base64') },
      });
    };
    await sc.opened;
    sc.emit({ usageEvent: {} });
    callerSaid('u1', 'status of p o one zero four eight two').forEach(sc.emit);
    say('0', one);
    agentSaid('x0', 'FINAL', '{ "interrupted" : true }').forEach(sc.emit);
    sc.emit({ contentEnd: { contentId: 'x0', type: 'TEXT', stopReason: 'INTERRUPTED' } });
    sc.emit({
      toolUse: { toolUseId: 't1', toolName: 'get_po_status', content: '{"po_code":"PO-10482"}' },
    });
    await wait(20);
    [one, two, three].forEach((text, i) => say(`${i + 1}`, text));
    [one, two, three].forEach((text, i) => agentSaid(`f${i + 1}`, 'FINAL', text).forEach(sc.emit));
    sc.emit({ completionEnd: {} });
    await wait(20);

    const [turn] = session.trace().turns;
    expect(turn.assistant.final_text).toBe(RENDERING_10482);
    expect(transcripts.filter((t) => t.role === 'ASSISTANT').map((t) => t.text)).toEqual([
      one,
      two,
      three,
    ]);
    expect(audio).toHaveLength(3);
    expect(turn.audio?.delivered_ms).toBe(3);
    session.close();
  });

  it('A: a late FINAL of the blocked answer does not count as speaking the result', async () => {
    const sc = scriptedClient();
    const { listener } = fakeListener();
    const session = new SonicSession(sc.client, listener, ROTATION, {
      phrases: fakePhrases(),
      fillerStallMs: 10_000,
      nudgeAfterMs: 30,
    });
    await sc.opened;
    sc.emit({ usageEvent: {} });
    callerSaid('u1', 'status of p o one zero four eight two').forEach(sc.emit);
    agentSaid('s0', 'SPECULATIVE', PO_ANSWER).forEach(sc.emit);
    sc.emit({
      toolUse: { toolUseId: 't1', toolName: 'get_po_status', content: '{"po_code":"PO-10482"}' },
    });
    await wait(20);
    agentSaid('f0', 'FINAL', PO_ANSWER).forEach(sc.emit);
    sc.emit({ contentEnd: { contentId: 'f0', type: 'TEXT', stopReason: 'END_TURN' } });
    await wait(80);

    expect(sentTexts(sc.input).at(-1)).toBe(SPEAK_NOW);
    expect(session.trace().turns[0].interventions).toEqual(['blocked-answer', 'prompt-to-speak']);
    expect(session.trace().turns[0].assistant.final_text).toBe('');
    session.close();
  });

  it('B: ignores a late FINAL of an earlier answer that lands in the next turn', async () => {
    const sc = scriptedClient();
    const { listener } = fakeListener();
    const session = new SonicSession(sc.client, listener, ROTATION, {
      phrases: fakePhrases(),
      fillerStallMs: 10_000,
    });
    await sc.opened;
    sc.emit({ usageEvent: {} });
    callerSaid('u1', 'hello').forEach(sc.emit);
    agentSaid('s1', 'SPECULATIVE', 'Hi.').forEach(sc.emit);
    callerSaid('u2', 'wait').forEach(sc.emit);
    agentSaid('f1', 'FINAL', PO_ANSWER).forEach(sc.emit);
    await wait(20);

    expect(sentTexts(sc.input)).not.toContain(LOOK_UP_FIRST);
    session.close();
  });

  it('A: asks Sonic to speak a lookup result it ended its response without speaking', async () => {
    const sc = scriptedClient();
    const { listener } = fakeListener();
    const session = new SonicSession(sc.client, listener, ROTATION, {
      phrases: fakePhrases(),
      fillerStallMs: 10_000,
      nudgeAfterMs: 30,
    });
    await sc.opened;
    sc.emit({ usageEvent: {} });
    callerSaid('u1', 'status of p o one zero four eight two').forEach(sc.emit);
    sc.emit({
      toolUse: { toolUseId: 't1', toolName: 'get_po_status', content: '{"po_code":"PO-10482"}' },
    });
    await wait(20);
    agentSaid('f1', 'FINAL', 'Let me check that.').forEach(sc.emit);
    sc.emit({ contentEnd: { contentId: 'f1', type: 'TEXT', stopReason: 'END_TURN' } });
    await wait(80);

    expect(sentTexts(sc.input).at(-1)).toBe(SPEAK_NOW);
    expect(session.trace().turns[0].interventions).toEqual(['prompt-to-speak']);
    session.close();
  });
});

describe('SonicSession rotation', () => {
  it('keeps agent text whose FINAL never came when a rotation retires its connection', async () => {
    // A long rendering's last FINAL sometimes never arrives; it was recovered only from the
    // connection's completionEnd, which a retired connection no longer delivers.
    const sc = scriptedClient();
    const { listener, transcripts } = fakeListener();
    const rotation = {
      thresholdMs: 20,
      bufferMs: 0,
      audioStartTimeoutMs: 10,
      handoverTimeoutMs: 10,
    };
    const session = new SonicSession(sc.client, listener, rotation, {
      phrases: fakePhrases(),
      fillerStallMs: 10_000,
    });
    await sc.opened;
    sc.emit({ usageEvent: {} });
    callerSaid('u1', 'hello').forEach(sc.emit);
    agentSaid('s1', 'SPECULATIVE', 'Hello there.').forEach(sc.emit);
    await wait(150);

    expect(session.trace().events.map((event) => event.fh.id)).toContain('FH-05');
    expect(session.trace().turns[0].assistant.final_text).toBe('Hello there.');
    expect(transcripts).toContainEqual({ role: 'ASSISTANT', text: 'Hello there.' });
    session.close();
  });
});
