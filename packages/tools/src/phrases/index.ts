/**
 * Fixed phrases spoken from pre-recorded audio (captured by `pnpm --filter host capture-phrases`)
 * instead of live Sonic generation, for failure behaviours where Sonic can't speak for itself:
 * FH-01 (the stream won't open), FH-03 (a stall past 1.5 s), FH-10 (a tool call timing out).
 * None of these repeat the system prompt's own "Let me check that." line.
 */
export interface FixedPhrase {
  id: 'FH-01' | 'FH-03' | 'FH-10';
  text: string;
}

export const FIXED_PHRASES: FixedPhrase[] = [
  {
    id: 'FH-01',
    text: "Sorry, this line can't take your call right now. Please try again shortly.",
  },
  { id: 'FH-03', text: 'One moment.' },
  { id: 'FH-10', text: 'Still checking, one moment.' },
];
