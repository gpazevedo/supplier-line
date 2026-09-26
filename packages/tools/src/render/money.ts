import { cardinal } from './numbers';

interface Unit {
  one: string;
  many: string;
}
interface Currency {
  major: Unit;
  minor?: Unit;
}

const CURRENCIES: Record<string, Currency> = {
  USD: { major: { one: 'dollar', many: 'dollars' }, minor: { one: 'cent', many: 'cents' } },
  EUR: { major: { one: 'euro', many: 'euros' }, minor: { one: 'cent', many: 'cents' } },
  GBP: { major: { one: 'pound', many: 'pounds' }, minor: { one: 'penny', many: 'pence' } },
  BRL: { major: { one: 'real', many: 'reais' }, minor: { one: 'centavo', many: 'centavos' } },
  JPY: { major: { one: 'yen', many: 'yen' } },
};

function amount(n: number, unit: Unit): string {
  return `${cardinal(n)} ${n === 1 ? unit.one : unit.many}`;
}

/**
 * Spoken money from integer minor units and an ISO 4217 code.
 * 123456, USD -> "one thousand two hundred thirty-four dollars and fifty-six cents".
 * Throws on a negative or non-integer amount or an unsupported currency.
 */
export function renderMoney(cents: number, currency: string): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new RangeError(`Invalid amount: ${cents}`);
  const spec = CURRENCIES[currency];
  if (!spec) throw new RangeError(`Unsupported currency: ${currency}`);
  if (!spec.minor) return amount(cents, spec.major);
  const major = Math.floor(cents / 100);
  const minor = cents % 100;
  if (minor === 0) return amount(major, spec.major);
  if (major === 0) return amount(minor, spec.minor);
  return `${amount(major, spec.major)} and ${amount(minor, spec.minor)}`;
}
