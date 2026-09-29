const DIGIT_WORDS: Record<string, string> = {
  zero: '0',
  oh: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
};
const TOKEN = new RegExp(`\\b(${Object.keys(DIGIT_WORDS).join('|')})\\b|\\d`, 'g');

/** Digits spoken in a caller transcript, in order: digit words, "oh" and numerals. */
export function spokenDigits(text: string): string {
  return [...text.toLowerCase().matchAll(TOKEN)].map(([t]) => DIGIT_WORDS[t] ?? t).join('');
}

const CODE_DIGITS = 5;

const midCode = (text: string) => {
  const digits = spokenDigits(text).length;
  return digits > 0 && digits < CODE_DIGITS;
};

/** Tool result content telling the model the caller has not finished reading the code. */
export const STILL_READING_RESULT = JSON.stringify({
  ok: false,
  reason: 'caller_still_reading',
});

const POLL_MS = 100;

/**
 * True when the model called the tool while the caller had said some but not all five digits of
 * a code in the current turn, and the caller then finished the code within `timeoutMs`: the
 * model is told to call again with the whole code. If no more digits come in time, the caller is
 * not reading any more (or the code was mis-heard), and the call runs as made.
 */
export async function callerStillReading(
  callerText: () => string,
  timeoutMs: number,
  sleep: (ms: number) => Promise<unknown>
): Promise<boolean> {
  if (!midCode(callerText())) return false;
  for (let waited = 0; waited < timeoutMs && midCode(callerText()); waited += POLL_MS) {
    await sleep(Math.min(POLL_MS, timeoutMs - waited));
  }
  return !midCode(callerText());
}
