import { randomUUID } from 'node:crypto';
import {
  InvokeModelWithBidirectionalStreamCommand,
  type BedrockRuntimeClient,
  type InvokeModelWithBidirectionalStreamCommandOutput,
} from '@aws-sdk/client-bedrock-runtime';
import { toolUseToResult } from 'tools/src/po-status/index.js';
import {
  audioInput,
  closingEvents,
  resumeEvents,
  setupEvents,
  toolResultEvents,
  type SessionIds,
  type SonicInputEvent,
} from './events.js';
import type { HistoryMessage } from './history.js';
import { AsyncQueue } from './queue.js';
import type { RotatingConnection } from './rotator.js';

export const MODEL_ID = 'amazon.nova-2-sonic-v1:0';

type Body = Record<string, unknown>;

/** Where a connection reports its output. */
export interface ConnectionHandlers {
  onEvent(from: SonicConnection, name: string, body: Body): void;
  onToolResult(from: SonicConnection, name: string, rendering: string): void;
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
    systemPrompt: string
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
    const result = await toolUseToResult(String(body.content));
    const { rendering } = JSON.parse(result) as { rendering: string };
    this.handlers.onToolResult(this, name, rendering);
    const events = toolResultEvents(this.ids.prompt, randomUUID(), String(body.toolUseId), result);
    events.forEach((e) => this.input.push(e));
  }
}
