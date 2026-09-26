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
const WORD = new RegExp(`\\b(${Object.keys(DIGIT_WORDS).join('|')})\\b`, 'g');
const SHAPE = /^po(\d{5})$/;

/**
 * Normalises a spoken-style PO code to `PO-NNNNN`, or returns null when it is not one.
 * "P O dash one zero four eight two", "po 10482" and "PO-10482" all give "PO-10482".
 */
export function normalisePoCode(spoken: string): string | null {
  const compact = spoken
    .toLowerCase()
    .replace(/\bdash\b/g, '')
    .replace(WORD, (w) => DIGIT_WORDS[w])
    .replace(/[^a-z0-9]/g, '');
  const match = SHAPE.exec(compact);
  return match && `PO-${match[1]}`;
}
