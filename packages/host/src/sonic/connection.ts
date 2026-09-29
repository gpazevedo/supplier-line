import { randomUUID } from 'node:crypto';
import {
  InvokeModelWithBidirectionalStreamCommand,
  type BedrockRuntimeClient,
  type InvokeModelWithBidirectionalStreamCommandOutput,
} from '@aws-sdk/client-bedrock-runtime';
import type { DelayOptions } from 'tools/src/po-status/delay.js';
import { toolUseToResult } from 'tools/src/po-status/index.js';
import {
  audioInput,
  closingEvents,
  resumeEvents,
  setupEvents,
  toolResultEvents,
  userTextEvents,
  type SessionIds,
  type SonicInputEvent,
} from './events.js';
import type { HistoryMessage } from './history.js';
import { AsyncQueue } from './queue.js';
import { STILL_READING_RESULT } from './reading.js';
import type { RotatingConnection } from './rotator.js';
import { callWithTimeout } from './tool-timeout.js';

export const MODEL_ID = 'amazon.nova-2-sonic-v1:0';

/** How long a `get_po_status` call may run before FH-10 plays a filler and retries once. */
export const TOOL_TIMEOUT_MS = 3000;

/** Spoken when the retry also fails to answer in time; the model is told to speak it exactly. */
const TOOL_TIMEOUT_APOLOGY =
  "Sorry, I'm having trouble looking that up right now. Please try again in a moment.";

type Body = Record<string, unknown>;

/** Where a connection reports its output. */
export interface ConnectionHandlers {
  onEvent(from: SonicConnection, name: string, body: Body): void;
  /** `found` is the code of the PO the lookup found, if any. */
  onToolResult(from: SonicConnection, name: string, rendering: string, found?: string): void;
  /** True to hold a lookup because the caller is still reading the code; the model is told so. */
  callerStillReading(from: SonicConnection): Promise<boolean>;
  /** FH-10: the tool call has exceeded its timeout; a filler plays and a retry is starting. */
  onToolTimeout(from: SonicConnection): void;
  /** One-shot delay (FH-03/FH-10 fault flag) applied to the next tool call only. */
  nextToolDelay(): DelayOptions;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * One Nova 2 Sonic bidirectional stream. It opens with the setup events and system prompt only;
 * `resume` adds the history and the caller-audio container. Tool calls are answered on the same
 * stream.
 */
export class SonicConnection implements RotatingConnection {
  private readonly ids: SessionIds = {
    prompt: randomUUID(),
    system: randomUUID(),
    audio: randomUUID(),
  };
  private readonly input = new AsyncQueue<SonicInputEvent>();
  private resumed = false;
  readonly opened: Promise<void>;
  /** Settles when Sonic ends the stream, or rejects with the stream's error. */
  readonly done: Promise<void>;

  constructor(
    client: BedrockRuntimeClient,
    private readonly handlers: ConnectionHandlers,
    systemPrompt: string,
    private readonly toolTimeoutMs = TOOL_TIMEOUT_MS
  ) {
    setupEvents(this.ids, systemPrompt).forEach((e) => this.input.push(e));
    const chunks = (async function* (queue: AsyncQueue<SonicInputEvent>) {
      for await (const e of queue) yield { chunk: { bytes: encoder.encode(JSON.stringify(e)) } };
    })(this.input);
    const response = client.send(
      new InvokeModelWithBidirectionalStreamCommand({ modelId: MODEL_ID, body: chunks })
    );
    this.opened = response.then(() => undefined);
    this.opened.catch(() => undefined);
    this.done = response.then((r) => this.consume(r));
  }

  resume(history: HistoryMessage[]): void {
    resumeEvents(this.ids, history).forEach((e) => this.input.push(e));
    this.resumed = true;
  }

  /** Sends Sonic a text message as the user (cross-modal input). */
  sendText(text: string): void {
    userTextEvents(this.ids.prompt, randomUUID(), text).forEach((e) => this.input.push(e));
  }

  sendAudio(pcm: Buffer): boolean {
    return this.input.push(audioInput(this.ids, pcm));
  }

  /** Sends the closing sequence (without the audio contentEnd if audio never started). */
  close(): void {
    closingEvents(this.ids)
      .slice(this.resumed ? 0 : 1)
      .forEach((e) => this.input.push(e));
    this.input.end();
  }

  private async consume(response: InvokeModelWithBidirectionalStreamCommandOutput): Promise<void> {
    for await (const part of response.body ?? []) {
      if (!part.chunk?.bytes) throw new Error(`Sonic stream error: ${JSON.stringify(part)}`);
      const { event } = JSON.parse(decoder.decode(part.chunk.bytes)) as { event: Body };
      const [name, body] = Object.entries(event)[0] as [string, Body];
      this.handlers.onEvent(this, name, body);
      if (name === 'toolUse') void this.onToolUse(body);
    }
  }

  private async onToolUse(body: Body): Promise<void> {
    const name = String(body.toolName);
    const reading = await this.handlers.callerStillReading(this);
    const result = reading ? STILL_READING_RESULT : await this.runToolCall(String(body.content));
    if (!reading) {
      const { rendering, po } = JSON.parse(result) as { rendering: string; po?: { code: string } };
      this.handlers.onToolResult(this, name, rendering, po?.code);
    }
    const events = toolResultEvents(this.ids.prompt, randomUUID(), String(body.toolUseId), result);
    events.forEach((e) => this.input.push(e));
  }

  /** Runs `get_po_status` with the FH-10 timeout and one retry; always resolves to a usable result. */
  private async runToolCall(content: string): Promise<string> {
    const { content: result } = await callWithTimeout(
      () => toolUseToResult(content, this.handlers.nextToolDelay()),
      this.toolTimeoutMs,
      () => this.handlers.onToolTimeout(this),
      () => JSON.stringify({ ok: false, reason: 'tool_timeout', rendering: TOOL_TIMEOUT_APOLOGY })
    );
    return result;
  }
}
