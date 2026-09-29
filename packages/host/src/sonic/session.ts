import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { NodeHttp2Handler } from '@smithy/node-http-handler';
import type { DelayOptions } from 'tools/src/po-status/delay.js';
import type { Trace } from 'traces/src/index.js';
import type { FixedPhrases } from '../phrases/fixed.js';
import { SonicConnection } from './connection.js';
import { FillerTimer } from './filler-timer.js';
import { Interventions, NUDGE_AFTER_MS } from './interventions.js';
import { Rotator, type RotationStats, type RotatorOptions } from './rotator.js';
import { continuedPrompt, SYSTEM_PROMPT } from './prompt.js';
import { callerStillReading } from './reading.js';
import { isInterruption, TurnRecorder } from './turns.js';

/** Longest a lookup is held while the caller finishes reading the code. */
const READING_TIMEOUT_MS = 4000;

/** How long with no agent audio after the caller stops speaking before FH-03 plays a filler. */
export const FH03_STALL_MS = 1500;

/** Fault flags that force a failure behaviour to trigger reliably, for the demo video. */
export interface SessionFault {
  /** FH-10: forces the session's first `get_po_status` call to wait this long. */
  toolDelayMs?: number;
  /**
   * FH-03: holds back the session's first turn's real agent audio for this long past the
   * caller's last segment, so the stall (and hence the filler) reliably happens regardless of
   * what Sonic says or how fast the lookup is. Held audio is replayed, in order, once released,
   * so nothing Sonic says is lost — only delayed.
   */
  holdAudioMs?: number;
}

export interface SessionOptions {
  /** The captured FH-01/03/10 audio and text (S15). */
  phrases: FixedPhrases;
  fault?: SessionFault;
  /** Overridable for tests; production uses `connection.js`'s default. */
  toolTimeoutMs?: number;
  /** Overridable for tests; production uses `FH03_STALL_MS`. */
  fillerStallMs?: number;
  /** Overridable for tests; production uses `NUDGE_AFTER_MS`. */
  nudgeAfterMs?: number;
}

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
  /** Sonic is consuming the stream: the caller can speak now. Called once. */
  onReady(): void;
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
  private readonly filler: FillerTimer;
  private readonly interventions: Interventions;
  private ending = false;
  /** False until the first connection's first output event; caller audio is dropped until then. */
  private ready = false;
  /** True once the very first connection's open failure has been handled (FH-01), so a second
   * report of the same failure (`opened` rejecting and `done` rejecting) is not handled twice. */
  private openFailed = false;
  /** One-shot fault delay (FH-10), consumed by the session's first tool call. */
  private faultToolDelayMs?: number;
  /** Fault hold window (FH-03), used once per session. */
  private readonly faultHoldAudioMs?: number;
  /** True once a hold has been armed for some turn, so a later turn never starts a new one. */
  private audioHoldUsed = false;
  /** Real agent audio buffered for `audioHold.turn` while the FH-03 fault hold is active; the
   * window resets on every caller segment in that turn, like the filler timer's own stall clock. */
  private audioHold?: { turn: number; chunks: Body[]; timer: NodeJS.Timeout };
  /** Code of the PO a lookup found most recently. */
  private lastOrder?: string;

  constructor(
    private readonly client: BedrockRuntimeClient,
    private readonly listener: SessionListener,
    rotation: RotatorOptions,
    private readonly options: SessionOptions
  ) {
    this.faultToolDelayMs = options.fault?.toolDelayMs;
    this.faultHoldAudioMs = options.fault?.holdAudioMs;
    this.interventions = new Interventions(options.nudgeAfterMs ?? NUDGE_AFTER_MS, {
      recorder: this.recorder,
      sendText: (text) => this.rotator.current.sendText(text),
      flush: (turn) => this.listener.onInterrupted(turn),
      log: (line) => this.log(line),
    });
    this.filler = new FillerTimer(options.fillerStallMs ?? FH03_STALL_MS, {
      onFire: (turn) => this.onFillerFire(turn),
      currentTurn: () => this.recorder.currentTurn,
    });
    const first = this.connect(SYSTEM_PROMPT);
    first.resume([]);
    void this.watchOpen(first);
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

  /**
   * Forwards caller audio once Sonic is ready. Audio from before then is dropped, not queued:
   * Sonic reads a backlog faster than real time, which runs its playback clock ahead of what the
   * caller hears and makes it miss barge-ins near the end of an answer.
   */
  sendAudio(pcm: Buffer): void {
    if (this.ready) this.rotator.audio(pcm);
  }

  /** Sends the closing sequence; `run` resolves once Sonic ends the stream. */
  close(): void {
    this.ending = true;
    this.filler.stop(); // so a pending or later-scheduled FH-03 timer can't fire after close
    this.interventions.stop();
    if (this.audioHold) {
      clearTimeout(this.audioHold.timer); // so a pending audio-hold release can't fire after close
      this.audioHold = undefined;
    }
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
          const turn = this.recorder.currentTurn;
          if (turn !== undefined) this.interventions.toolResult(turn, rendering);
          this.rotator.onToolResult(from, rendering);
        },
        callerStillReading: (from) => this.callerStillReading(from),
        onToolTimeout: (from) => this.onToolTimeout(from),
        nextToolDelay: () => this.takeToolDelay(),
      },
      systemPrompt,
      this.options.toolTimeoutMs
    );
    connection.done.then(
      () => this.onEnded(connection),
      (error: unknown) => this.onEnded(connection, error)
    );
    return connection;
  }

  /** Resolves the very first open, or hands its rejection to FH-01 (the stream would not open). */
  private async watchOpen(connection: SonicConnection): Promise<void> {
    try {
      await connection.opened;
    } catch (error) {
      this.onOpenFailed(connection, error);
    }
  }

  private onOpenFailed(connection: SonicConnection, error: unknown): void {
    if (connection !== this.rotator.current || this.openFailed) return;
    this.openFailed = true;
    console.error(`session ${this.id}: Sonic stream would not open`, error);
    const phrase = this.options.phrases['FH-01'];
    const turn = this.recorder.onFallback(phrase.text, phrase.pcm.length, this.elapsedMs());
    this.events.push({ fh: { id: 'FH-01' }, at_ms: this.elapsedMs() });
    this.listener.onAudio(phrase.pcm, turn);
    this.ending = true;
    this.finished.resolve(undefined);
  }

  /** The next tool call's one-shot fault delay (FH-03/FH-10), if a fault flag set one. */
  private takeToolDelay(): DelayOptions {
    const delayMs = this.faultToolDelayMs;
    this.faultToolDelayMs = undefined;
    return delayMs ? { delayMs } : {};
  }

  /** FH-10: a tool call exceeded its timeout; play the filler and trace the event. */
  private onToolTimeout(from: SonicConnection): void {
    if (from !== this.rotator.current) return;
    const turn = this.recorder.currentTurn;
    if (turn === undefined) return;
    const phrase = this.options.phrases['FH-10'];
    this.recorder.onFiller(turn, phrase.pcm.length);
    this.events.push({ fh: { id: 'FH-10' }, at_ms: this.elapsedMs(), turn });
    this.listener.onAudio(phrase.pcm, turn);
    this.log(`FH-10 tool timeout on turn ${turn}: filler played, retrying`);
  }

  /** FH-03: no agent audio started within the stall window; play the filler once for the turn. */
  private onFillerFire(turn: number): void {
    const phrase = this.options.phrases['FH-03'];
    this.recorder.onFiller(turn, phrase.pcm.length);
    this.events.push({ fh: { id: 'FH-03' }, at_ms: this.elapsedMs(), turn });
    this.listener.onAudio(phrase.pcm, turn);
    this.log(`FH-03 stall on turn ${turn}: filler played`);
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
    if (this.openFailed) return;
    if (error) this.finished.reject(error);
    else if (this.ending) this.finished.resolve(undefined);
    else this.finished.reject(new Error('Sonic ended the stream'));
  }

  /** Keeps agent text whose FINAL never came; its connection has finished or been retired. */
  private recoverUnconfirmedText(): void {
    this.recorder
      .onCompletionEnd()
      .forEach((text) => this.listener.onTranscript('ASSISTANT', text));
  }

  private onRotated({ gapMs, audioInMs, audioForwardedMs }: RotationStats): void {
    this.recoverUnconfirmedText();
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
    if (process.env.DEBUG_EVENTS) this.log(`RAW ${name} ${JSON.stringify(body).slice(0, 300)}`);
    if (!this.ready) this.onReady();
    if (name === 'audioOutput') {
      if (this.isHoldingAudio()) this.audioHold?.chunks.push(body);
      else this.processAudioOutput(body);
      return;
    }
    if (this.recorder.onEvent(name, body, this.elapsedMs())) {
      this.log(`barge-in on turn ${this.recorder.currentTurn} (${name})`);
      this.listener.onInterrupted(this.recorder.currentTurn);
    }
    if (name === 'toolUse') this.log(`toolUse ${String(body.content)}`);
    if (name === 'userSpeechStart') this.filler.speechStarted();
    if (name === 'userSpeechStart') this.interventions.callerSpoke();
    if (name === 'contentEnd' && body.stopReason === 'END_TURN') this.interventions.responseEnded();
    if (name === 'userSpeechEnd') this.filler.speechEnded();
    if (name === 'contentStart') this.onContentStart(body);
    if (name === 'textOutput') this.onText(body);
    if (name === 'completionEnd') this.recoverUnconfirmedText();
    this.rotator.onOutput(from, name, body);
  }

  private onReady(): void {
    this.ready = true;
    this.log('ready');
    this.listener.onReady();
  }

  /** Runs one `audioOutput` event through the normal pipeline (ledger, filler cancel, playback). */
  private processAudioOutput(body: Body): void {
    this.rotator.onOutput(this.rotator.current, 'audioOutput', body);
    if (this.interventions.mutes(this.recorder.currentTurn)) return;
    this.recorder.onEvent('audioOutput', body, this.elapsedMs());
    this.filler.audio();
    this.onAudio(String(body.content));
  }

  private isHoldingAudio(): boolean {
    return this.audioHold !== undefined && this.audioHold.turn === this.recorder.currentTurn;
  }

  /**
   * FH-03 fault: (re)starts buffering `turn`'s real agent audio for `faultHoldAudioMs`, so it
   * survives a caller reading a code digit by digit across several segments, the same way the
   * filler timer's own stall clock does. Used once per session: a later turn never starts a hold.
   */
  private armAudioHold(turn: number): void {
    const holdMs = this.faultHoldAudioMs;
    if (holdMs === undefined) return;
    if (this.audioHold?.turn === turn) {
      clearTimeout(this.audioHold.timer);
      this.audioHold.timer = setTimeout(() => this.releaseAudioHold(), holdMs);
      return;
    }
    if (this.audioHoldUsed) return;
    this.audioHoldUsed = true;
    this.audioHold = { turn, chunks: [], timer: setTimeout(() => this.releaseAudioHold(), holdMs) };
  }

  /** Replays the held audio, in order, once the fault hold's window has passed. */
  private releaseAudioHold(): void {
    const hold = this.audioHold;
    this.audioHold = undefined;
    hold?.chunks.forEach((body) => this.processAudioOutput(body));
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
    const turn = this.recorder.currentTurn;
    const final = this.finalIds.has(id);
    if (isInterruption(text)) return;
    if (role === 'ASSISTANT' && !final && turn !== undefined)
      this.interventions.assistantText(turn, text, false);
    if (role === 'ASSISTANT' && final)
      this.recorder.takeConfirmed().forEach((t) => this.onHeard(t));
    if (role !== 'USER' || !final) return;
    this.log(`caller ${JSON.stringify(text)}`);
    if (turn !== undefined) this.armAudioHold(turn);
    this.listener.onTranscript(role, text);
  }

  /** Agent text the recorder confirmed the caller heard: never text muted as ungrounded. */
  private onHeard(text: string): void {
    const turn = this.recorder.currentTurn;
    if (turn !== undefined) this.interventions.assistantText(turn, text, true);
    this.listener.onTranscript('ASSISTANT', text);
  }
}
