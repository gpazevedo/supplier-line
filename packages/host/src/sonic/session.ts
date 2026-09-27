import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { NodeHttp2Handler } from '@smithy/node-http-handler';
import type { Trace } from 'traces/src/index.js';
import { SonicConnection } from './connection.js';
import { Rotator, type RotationStats, type RotatorOptions } from './rotator.js';
import { continuedPrompt, SYSTEM_PROMPT } from './prompt.js';
import { callerStillReading } from './reading.js';
import { isInterruption, TurnRecorder } from './turns.js';

/** Longest a lookup is held while the caller finishes reading the code. */
const READING_TIMEOUT_MS = 4000;

/** Bedrock client for `us-east-1` over HTTP/2, which the bidirectional stream requires. */
export function createSonicClient(): BedrockRuntimeClient {
  return new BedrockRuntimeClient({
    region: 'us-east-1',
    requestHandler: new NodeHttp2Handler({
      requestTimeout: 300_000,
      sessionTimeout: 300_000,
      disableConcurrentStreams: false,
      maxConcurrentStreams: 20,
    }),
  });
}

/** What the session reports to its front door as the model responds. */
export interface SessionListener {
  /** Agent audio: 24 kHz 16-bit mono PCM, for the turn in progress (none before the caller speaks). */
  onAudio(pcm: Buffer, turn: number | undefined): void;
  /** Sonic detected the caller barging in on `turn`: queued agent audio should be dropped. */
  onInterrupted(turn: number | undefined): void;
  /** A FINAL transcript line, from the caller or the agent. */
  onTranscript(role: 'USER' | 'ASSISTANT', text: string): void;
}

type Body = Record<string, unknown>;
type TraceEvent = Trace['events'][number];

/**
 * One call with `get_po_status` wired in, recording a trace as it runs. The call outlives Sonic's
 * 8-minute connection limit by rotating connections (FH-05); only the current one is heard.
 */
export class SonicSession {
  readonly id = randomUUID();
  private readonly startedAt = new Date();
  private readonly recorder = new TurnRecorder();
  private readonly events: TraceEvent[] = [];
  private readonly finalIds = new Set<string>();
  private readonly roles = new Map<string, string>();
  private readonly finished = Promise.withResolvers<undefined>();
  private readonly rotator: Rotator<SonicConnection>;
  private ending = false;
  /** Code of the PO a lookup found most recently. */
  private lastOrder?: string;

  constructor(
    private readonly client: BedrockRuntimeClient,
    private readonly listener: SessionListener,
    rotation: RotatorOptions
  ) {
    const first = this.connect(SYSTEM_PROMPT);
    first.resume([]);
    this.rotator = new Rotator(
      first,
      {
        open: () => this.connect(continuedPrompt(this.lastOrder)),
        history: () => this.recorder.history(),
        rotated: (stats) => this.onRotated(stats),
      },
      rotation
    );
  }

  /** Resolves once the call has been closed and its current connection has ended. */
  run(): Promise<undefined> {
    return this.finished.promise;
  }

  sendAudio(pcm: Buffer): void {
    this.rotator.audio(pcm);
  }

  /** Sends the closing sequence; `run` resolves once Sonic ends the stream. */
  close(): void {
    this.ending = true;
    this.rotator.close();
  }

  /** The client's running total of milliseconds played for a turn. */
  onPlayed(turn: number, ms: number): void {
    this.recorder.ledger.played(turn, ms);
  }

  /** The client flushed its queue after a barge-in, having played `ms` of the turn. */
  onFlushed(turn: number, ms: number): void {
    this.recorder.ledger.flushed(turn, ms, this.elapsedMs());
  }

  trace(): Trace {
    return {
      session_id: this.id,
      front_door: 'softphone',
      started_at: this.startedAt.toISOString(),
      turns: this.recorder.turns(),
      events: this.events,
    };
  }

  private connect(systemPrompt: string): SonicConnection {
    const connection = new SonicConnection(
      this.client,
      {
        onEvent: (from, name, body) => this.onEvent(from, name, body),
        onToolResult: (from, name, rendering, found) => {
          if (from !== this.rotator.current) return;
          this.lastOrder = found ?? this.lastOrder;
          this.recorder.onToolResult(name, rendering);
          this.rotator.onToolResult(from, rendering);
        },
        callerStillReading: (from) => this.callerStillReading(from),
      },
      systemPrompt
    );
    connection.done.then(
      () => this.onEnded(connection),
      (error: unknown) => this.onEnded(connection, error)
    );
    return connection;
  }

  private async callerStillReading(from: SonicConnection): Promise<boolean> {
    if (from !== this.rotator.current) return false;
    const text = () => this.recorder.callerText();
    const reading = await callerStillReading(text, READING_TIMEOUT_MS, sleep);
    if (reading) {
      this.recorder.onEarlyToolCall();
      this.log(`toolUse held: caller still reading ${JSON.stringify(text())}`);
    }
    return reading;
  }

  private onEnded(connection: SonicConnection, error?: unknown): void {
    if (connection !== this.rotator.current) {
      if (error) console.error(`session ${this.id}: retired Sonic connection failed`, error);
      return;
    }
    if (error) this.finished.reject(error);
    else if (this.ending) this.finished.resolve(undefined);
    else this.finished.reject(new Error('Sonic ended the stream'));
  }

  private onRotated({ gapMs, audioInMs, audioForwardedMs }: RotationStats): void {
    const turn = this.recorder.currentTurn;
    const event: TraceEvent = {
      fh: { id: 'FH-05' },
      at_ms: this.elapsedMs(),
      ...(turn !== undefined && { turn }),
      rotation: { audio_in_ms: audioInMs, audio_forwarded_ms: audioForwardedMs, gap_ms: gapMs },
    };
    this.events.push(event);
    console.log(`session ${this.id}: FH-05 rotation`, JSON.stringify(event));
  }

  private onEvent(from: SonicConnection, name: string, body: Body): void {
    if (from !== this.rotator.current) {
      if (name === 'toolUse') console.warn(`session ${this.id}: toolUse on a retired connection`);
      return;
    }
    this.recorder.onEvent(name, body, this.elapsedMs());
    if (name === 'toolUse') this.log(`toolUse ${String(body.content)}`);
    if (name === 'contentStart') this.onContentStart(body);
    if (name === 'textOutput') this.onText(body);
    if (name === 'audioOutput') this.onAudio(String(body.content));
    if (name === 'contentEnd' && body.stopReason === 'INTERRUPTED')
      this.listener.onInterrupted(this.recorder.currentTurn);
    this.rotator.onOutput(from, name, body);
  }

  private log(line: string): void {
    console.log(`session ${this.id} +${this.elapsedMs()} ms: ${line}`);
  }

  private elapsedMs(): number {
    return Date.now() - this.startedAt.getTime();
  }

  private onAudio(base64: string): void {
    this.listener.onAudio(Buffer.from(base64, 'base64'), this.recorder.currentTurn);
  }

  private onContentStart(body: Body): void {
    const id = String(body.contentId);
    this.roles.set(id, String(body.role));
    if (String(body.additionalModelFields).includes('"FINAL"')) this.finalIds.add(id);
  }

  private onText(body: Body): void {
    const id = String(body.contentId);
    const role = this.roles.get(id);
    const text = String(body.content);
    if (!this.finalIds.has(id) || isInterruption(text)) return;
    if (role !== 'USER' && role !== 'ASSISTANT') return;
    if (role === 'USER') this.log(`caller ${JSON.stringify(text)}`);
    this.listener.onTranscript(role, text);
  }
}
