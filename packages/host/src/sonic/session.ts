import { randomUUID } from 'node:crypto';
import {
  BedrockRuntimeClient,
  InvokeModelWithBidirectionalStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { NodeHttp2Handler } from '@smithy/node-http-handler';
import { toolUseToResult } from 'tools/src/po-status/index.js';
import type { Trace } from 'traces/src/index.js';
import {
  audioInput,
  closingEvents,
  openingEvents,
  toolResultEvents,
  type SessionIds,
  type SonicInputEvent,
} from './events.js';
import { AsyncQueue } from './queue.js';
import { TurnRecorder } from './turns.js';

export const MODEL_ID = 'amazon.nova-2-sonic-v1:0';

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
  /** Agent audio: 24 kHz 16-bit mono PCM. */
  onAudio(pcm: Buffer): void;
  /** A FINAL transcript line, from the caller or the agent. */
  onTranscript(role: 'USER' | 'ASSISTANT', text: string): void;
}

type Body = Record<string, unknown>;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** One Nova 2 Sonic conversation with `get_po_status` wired in, recording a trace as it runs. */
export class SonicSession {
  readonly id = randomUUID();
  private readonly startedAt = new Date();
  private readonly ids: SessionIds = {
    prompt: randomUUID(),
    system: randomUUID(),
    audio: randomUUID(),
  };
  private readonly input = new AsyncQueue<SonicInputEvent>();
  private readonly recorder = new TurnRecorder();
  private readonly finalIds = new Set<string>();
  private readonly roles = new Map<string, string>();

  constructor(
    private readonly client: BedrockRuntimeClient,
    private readonly listener: SessionListener
  ) {}

  /** Opens the stream and consumes model output until the session ends. */
  async run(): Promise<void> {
    openingEvents(this.ids).forEach((e) => this.input.push(e));
    const chunks = (async function* (queue: AsyncQueue<SonicInputEvent>) {
      for await (const e of queue) yield { chunk: { bytes: encoder.encode(JSON.stringify(e)) } };
    })(this.input);
    const response = await this.client.send(
      new InvokeModelWithBidirectionalStreamCommand({ modelId: MODEL_ID, body: chunks })
    );
    for await (const part of response.body ?? []) {
      if (!part.chunk?.bytes) throw new Error(`Sonic stream error: ${JSON.stringify(part)}`);
      const { event } = JSON.parse(decoder.decode(part.chunk.bytes)) as { event: Body };
      const [name, body] = Object.entries(event)[0] as [string, Body];
      this.onEvent(name, body);
    }
  }

  sendAudio(pcm: Buffer): void {
    this.input.push(audioInput(this.ids, pcm));
  }

  /** Sends the closing sequence; `run` resolves once Sonic ends the stream. */
  close(): void {
    closingEvents(this.ids).forEach((e) => this.input.push(e));
    this.input.end();
  }

  trace(): Trace {
    return {
      session_id: this.id,
      front_door: 'softphone',
      started_at: this.startedAt.toISOString(),
      turns: this.recorder.turns(),
      events: [],
    };
  }

  private onEvent(name: string, body: Body): void {
    this.recorder.onEvent(name, body, Date.now() - this.startedAt.getTime());
    if (name === 'contentStart') this.onContentStart(body);
    if (name === 'textOutput') this.onText(body);
    if (name === 'audioOutput') this.listener.onAudio(Buffer.from(String(body.content), 'base64'));
    if (name === 'toolUse') void this.onToolUse(body);
  }

  private onContentStart(body: Body): void {
    const id = String(body.contentId);
    this.roles.set(id, String(body.role));
    if (String(body.additionalModelFields).includes('"FINAL"')) this.finalIds.add(id);
  }

  private onText(body: Body): void {
    const id = String(body.contentId);
    const role = this.roles.get(id);
    if (!this.finalIds.has(id) || (role !== 'USER' && role !== 'ASSISTANT')) return;
    this.listener.onTranscript(role, String(body.content));
  }

  private async onToolUse(body: Body): Promise<void> {
    const name = String(body.toolName);
    const result = await toolUseToResult(String(body.content));
    this.recorder.onToolResult(name, (JSON.parse(result) as { rendering: string }).rendering);
    const events = toolResultEvents(this.ids.prompt, randomUUID(), String(body.toolUseId), result);
    events.forEach((e) => this.input.push(e));
  }
}
