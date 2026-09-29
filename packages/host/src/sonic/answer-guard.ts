import { speaksPoData } from 'traces/src/po-data.js';

/**
 * Blocks ungrounded answers: agent text in a turn with no `get_po_status` result that starts to
 * speak PO data (the grounded-po-data check's own detection). The turn's audio is then muted until
 * a lookup result arrives for it; each turn is blocked at most once.
 */
export class AnswerGuard {
  private grounded = new Set<number>();
  private blocked = new Set<number>();
  private mutedTurn?: number;

  toolResult(turn: number): void {
    this.grounded.add(turn);
    if (this.mutedTurn === turn) this.mutedTurn = undefined;
  }

  /** Returns true when this text blocks the turn. */
  assistantText(turn: number, text: string): boolean {
    if (this.grounded.has(turn) || this.blocked.has(turn) || !speaksPoData(text)) return false;
    this.blocked.add(turn);
    this.mutedTurn = turn;
    return true;
  }

  muted(turn: number | undefined): boolean {
    return turn !== undefined && this.mutedTurn === turn;
  }
}
