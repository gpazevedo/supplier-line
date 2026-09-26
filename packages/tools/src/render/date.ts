import { cardinal, underHundred } from './numbers';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const ORDINAL_ONES = [
  '',
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
  'eleventh',
  'twelfth',
  'thirteenth',
  'fourteenth',
  'fifteenth',
  'sixteenth',
  'seventeenth',
  'eighteenth',
  'nineteenth',
];
const ORDINAL_TENS: Record<number, string> = { 20: 'twentieth', 30: 'thirtieth' };

function ordinal(day: number): string {
  if (day < 20) return ORDINAL_ONES[day];
  if (day % 10 === 0) return ORDINAL_TENS[day];
  return `${underHundred(day - (day % 10))}-${ORDINAL_ONES[day % 10]}`;
}

/** Years read as pairs ("twenty twenty-six"), except 2000-2009 ("two thousand five"). */
function year(y: number): string {
  if (y >= 2000 && y < 2010) return cardinal(y);
  const [high, low] = [Math.floor(y / 100), y % 100];
  return low === 0 ? `${underHundred(high)} hundred` : `${underHundred(high)} ${underHundred(low)}`;
}

/** Spoken date from an ISO date. "2026-10-03" -> "October third, twenty twenty-six". */
export function renderDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new RangeError(`Invalid ISO date: "${iso}"`);
  const [y, m, d] = iso.split('-').map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    throw new RangeError(`Invalid ISO date: "${iso}"`);
  }
  return `${MONTHS[m - 1]} ${ordinal(d)}, ${year(y)}`;
}
