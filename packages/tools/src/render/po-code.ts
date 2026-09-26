import { cardinal } from './numbers';

/** Spoken PO code, one character at a time: "PO-104" -> "P O dash one zero four". */
export function renderPoCode(code: string): string {
  if (!/^[A-Za-z0-9-]+$/.test(code)) throw new RangeError(`Invalid PO code: "${code}"`);
  return [...code]
    .map((c) => (c === '-' ? 'dash' : /\d/.test(c) ? cardinal(Number(c)) : c.toUpperCase()))
    .join(' ');
}
