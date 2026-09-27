import type { Trace } from 'traces/src/index.js';
import { heardText, type HistoryMessage } from './history.js';
import { PlaybackLedger } from './ledger.js';

type TraceTurn = Trace['turns'][number];

interface Block {
  role: string;
  final: boolean;
}

interface OpenTurn {
  index: number;
  callerAt: number;
  firstAudioAt?: number;
  tool?: { name: string; rendering: string };
  earlyToolCalls: number;
  caller: string[];
  spoken: string[];
}

type Body = Record<string, unknown>;

export const isInterruption = (text: string) => /"interrupted"\s*:\s*true/.test(text);

/**
 * Folds Sonic output events into trace turns. A turn starts with the caller's transcript;
 * its latency runs from the caller's last transcript segment to the first agent audio chunk. The playback ledger
 * records planned, generated and heard audio per turn.
 */
export class TurnRecorder {
  readonly ledger = new PlaybackLedger();
  private blocks = new Map<string, Block>();
  private open: OpenTurn[] = [];

  /** Index of the turn now in progress; undefined before the caller first speaks. */
  get currentTurn(): number | undefined {
    return this.current?.index;
  }

  /** Feeds one output event, stamped with milliseconds since the session started. */
  onEvent(name: string, body: Body, atMs: number): void {
    const id = String(body.contentId);
    if (name === 'contentStart') this.blocks.set(id, blockOf(body));
    if (name === 'audioOutput') this.onAudio(String(body.content), atMs);
    if (name === 'contentEnd' && body.stopReason === 'INTERRUPTED') this.onInterrupted(atMs);
    if (name === 'textOutput') this.onText(this.blocks.get(id), String(body.content), atMs);
  }

  /** The caller's transcript so far in the current turn. */
  callerText(): string {
    return this.current?.caller.join(' ') ?? '';
  }

  /** Counts a lookup refused because the caller was still reading the code. */
  onEarlyToolCall(): void {
    if (this.current) this.current.earlyToolCalls += 1;
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
      ...this.ledger.entry(index),
      ...(turn.tool && { tool: turn.tool }),
      ...(turn.earlyToolCalls > 0 && { early_tool_calls: turn.earlyToolCalls }),
      assistant: { final_text: turn.spoken.join(' ') },
    }));
  }

  /**
   * Caller and agent text per turn; a barged-in answer keeps only what the caller heard. An answer
   * built from a tool result is left out: a new connection copies earlier replies, so it would
   * speak that PO data again without calling the tool.
   */
  history(): HistoryMessage[] {
    return this.open.flatMap((turn) => {
      const messages: HistoryMessage[] = [
        { role: 'USER', text: turn.caller.join(' ') },
        { role: 'ASSISTANT', text: turn.tool ? '' : this.heard(turn) },
      ];
      return messages.filter((message) => message.text);
    });
  }

  private heard(turn: OpenTurn): string {
    const spoken = turn.spoken.join(' ');
    const heardMs = this.ledger.heardMs(turn.index);
    return heardMs === undefined ? spoken : heardText(spoken, heardMs);
  }

  private get current(): OpenTurn | undefined {
    return this.open.at(-1);
  }

  private onAudio(base64: string, atMs: number): void {
    const turn = this.current;
    if (!turn) return;
    turn.firstAudioAt ??= atMs;
    this.ledger.generated(turn.index, Buffer.byteLength(base64, 'base64'));
  }

  private onInterrupted(atMs: number): void {
    if (this.currentTurn !== undefined) this.ledger.interrupted(this.currentTurn, atMs);
  }

  private onText(block: Block | undefined, text: string, atMs: number): void {
    if (block?.role === 'ASSISTANT' && !block.final && this.current) {
      this.ledger.planned(this.current.index, text);
    }
    if (!block?.final || isInterruption(text)) return;
    if (block.role === 'USER' && this.answered())
      this.open.push({
        index: this.open.length,
        callerAt: atMs,
        caller: [],
        spoken: [],
        earlyToolCalls: 0,
      });
    else if (block.role === 'USER' && this.current) this.current.callerAt = atMs;
    if (block.role === 'USER') this.current?.caller.push(text.trim());
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
