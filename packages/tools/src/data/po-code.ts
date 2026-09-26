/**
 * PO code check digit. A code is `PO-` plus four body digits and one check digit.
 *
 * Scheme: weighted mod-10 sum with weights 1, 3, 7, 9 on the body digits
 * (all coprime to 10) and a fixed offset of 3:
 *
 *   check = (3 - (1*d1 + 3*d2 + 7*d3 + 9*d4)) mod 10
 *
 * A valid code therefore has 1*d1 + 3*d2 + 7*d3 + 9*d4 + 1*check = 3 (mod 10).
 * Every weight is coprime to 10, so changing any one digit (the check digit
 * included, weight 1) to a different value changes the sum by w*delta, which is
 * never 0 mod 10: every single-digit substitution is detected.
 *
 * The offset is needed: with only odd weights, a sum of 0 is impossible for
 * PO-10482 (its weighted sum is always odd). The offset 3 makes both PO-10482
 * and PO-20931 valid.
 */
const WEIGHTS = [1, 3, 7, 9];
const OFFSET = 3;
const CODE = /^PO-(\d{4})(\d)$/;

/** Check digit for a four-digit body, e.g. "1048" -> 2. */
export function checkDigit(body: string): number {
  const sum = WEIGHTS.reduce((acc, w, i) => acc + w * Number(body[i]), 0);
  return (((OFFSET - sum) % 10) + 10) % 10;
}

/** True when `code` is `PO-NNNNN` and its last digit matches the body's check digit. */
export function isValidPoCode(code: string): boolean {
  const match = CODE.exec(code);
  return match !== null && checkDigit(match[1]) === Number(match[2]);
}
