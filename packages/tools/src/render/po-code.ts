import { cardinal } from './numbers';

const CODE = /^PO-(\d+)$/;

/** Spoken PO code, digit by digit, without the "PO-" prefix: "PO-10482" -> "one zero four eight two". */
export function renderPoCode(code: string): string {
  const match = CODE.exec(code);
  if (!match) throw new RangeError(`Invalid PO code: "${code}"`);
  return [...match[1]].map((d) => cardinal(Number(d))).join(' ');
}
