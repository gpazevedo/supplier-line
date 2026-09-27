import { SPOKEN_MS_PER_CHAR } from './ledger.js';

/** One conversation message replayed into a new Sonic connection. */
export interface HistoryMessage {
  role: 'USER' | 'ASSISTANT';
  text: string;
}

/** The part of `text` a caller heard in `heardMs`, cut back to the last whole word. */
export function heardText(text: string, heardMs: number): string {
  const chars = Math.floor(heardMs / SPOKEN_MS_PER_CHAR);
  if (chars >= text.length) return text;
  const cut = text.slice(0, chars + 1);
  return cut.slice(0, Math.max(0, cut.lastIndexOf(' '))).trim();
}
