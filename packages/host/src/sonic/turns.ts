import type { Trace } from 'traces/src/index.js';

type TraceTurn = Trace['turns'][number];

interface Block {
  role: string;
  final: boolean;
}

interface OpenTurn {
  callerAt: number;
  firstAudioAt?: number;
  tool?: { name: string; rendering: string };
  spoken: string[];
}

type Body = Record<string, unknown>;

const isInterruption = (text: string) => /"interrupted"\s*:\s*true/.test(text);

/**
 * Folds Sonic output events into trace turns. A turn starts with the caller's transcript;
 * its latency runs from that transcript to the first agent audio chunk.
 */
export class TurnRecorder {
  private blocks = new Map<string, Block>();
  private open: OpenTurn[] = [];

  /** Feeds one output event, stamped with milliseconds since the session started. */
  onEvent(name: string, body: Body, atMs: number): void {
    const id = String(body.contentId);
    if (name === 'contentStart') this.blocks.set(id, blockOf(body));
    if (name === 'audioOutput' && this.current) this.current.firstAudioAt ??= atMs;
    if (name === 'textOutput') this.onText(this.blocks.get(id), String(body.content), atMs);
  }

  /** Records the rendering a tool returned during the current turn. */
  onToolResult(name: string, rendering: string): void {
    if (this.current) this.current.tool = { name, rendering };
  }

  turns(): TraceTurn[] {
    return this.open.map((turn, index) => ({
      index,
      latency: {
        voice_to_voice_ms: Math.max(0, (turn.firstAudioAt ?? turn.callerAt) - turn.callerAt),
      },
      ...(turn.tool && { tool: turn.tool }),
      assistant: { final_text: turn.spoken.join(' ') },
    }));
  }

  private get current(): OpenTurn | undefined {
    return this.open.at(-1);
  }

  private onText(block: Block | undefined, text: string, atMs: number): void {
    if (!block?.final || isInterruption(text)) return;
    if (block.role === 'USER' && this.answered()) this.open.push({ callerAt: atMs, spoken: [] });
    if (block.role === 'ASSISTANT' && this.current) this.current.spoken.push(text.trim());
  }

  /** True when there is no turn yet, or the current one already has agent output. */
  private answered(): boolean {
    const turn = this.current;
    return !turn || turn.spoken.length > 0 || turn.firstAudioAt !== undefined;
  }
}

function blockOf(body: Body): Block {
  const fields = typeof body.additionalModelFields === 'string' ? body.additionalModelFields : '';
  return { role: String(body.role), final: fields.includes('"FINAL"') };
}
