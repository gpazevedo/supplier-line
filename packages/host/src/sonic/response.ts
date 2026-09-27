import { isInterruption } from './turns.js';

type Body = Record<string, unknown>;

/** `speaking`: the agent started an audio block. `complete`: its response has finished generating. */
export type ResponseSignal = 'speaking' | 'complete' | undefined;

interface PendingTool {
  rendering?: string;
  spoken: string;
}

const RENDERING_PREFIX_CHARS = 30;
const normalise = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Tracks one connection's agent responses, as AWS's session-continuation sample does: a response
 * is complete when every SPECULATIVE text has its FINAL, or when a text block ends INTERRUPTED.
 * Sonic may answer "Go on" while a tool call is still in flight and speak the result as a later
 * response, so a tool call keeps the response open until its rendering is spoken, the caller
 * barges in, or the caller speaks again after the agent replied.
 */
export class ResponseTracker {
  private speculative = 0;
  private final = 0;
  private stages = new Map<string, { role: string; stage: string }>();
  private tool?: PendingTool;

  /** True when no agent response is being generated or owed for a tool call. */
  get idle(): boolean {
    return this.speculative === this.final && !this.tool;
  }

  onEvent(name: string, body: Body): ResponseSignal {
    if (name === 'contentStart') return this.onContentStart(body);
    if (name === 'textOutput') return this.onText(body);
    if (name === 'toolUse') this.tool = { spoken: '' };
    if (name === 'contentEnd' && body.type === 'TEXT' && body.stopReason === 'INTERRUPTED') {
      this.tool = undefined;
      return 'complete';
    }
    return undefined;
  }

  /** The rendering the pending tool call returned; the call is answered once it is spoken. */
  toolResult(rendering: string): void {
    if (this.tool) this.tool.rendering = rendering;
  }

  private onContentStart(body: Body): ResponseSignal {
    if (body.role === 'ASSISTANT' && body.type === 'AUDIO') return 'speaking';
    const fields = String(body.additionalModelFields);
    const stage = fields.includes('"FINAL"') ? 'FINAL' : 'SPECULATIVE';
    this.stages.set(String(body.contentId), { role: String(body.role), stage });
    return undefined;
  }

  private onText(body: Body): ResponseSignal {
    const block = this.stages.get(String(body.contentId));
    const text = String(body.content);
    if (!block || isInterruption(text)) return undefined;
    if (block.role === 'USER' && block.stage === 'FINAL' && this.tool?.spoken)
      this.tool = undefined;
    if (block.role !== 'ASSISTANT') return undefined;
    if (block.stage === 'SPECULATIVE') this.speculative += 1;
    if (block.stage === 'SPECULATIVE') return undefined;
    this.final += 1;
    if (this.tool) this.onToolReply(this.tool, text);
    return this.idle ? 'complete' : undefined;
  }

  private onToolReply(tool: PendingTool, text: string): void {
    tool.spoken = normalise(`${tool.spoken} ${text}`);
    const prefix = normalise(tool.rendering?.slice(0, RENDERING_PREFIX_CHARS) ?? '');
    if (prefix && tool.spoken.includes(prefix)) this.tool = undefined;
  }
}
