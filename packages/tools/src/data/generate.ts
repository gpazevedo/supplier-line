import { checkDigit } from './po-code';
import { seededRandom } from './random';
import { PO_STATUSES, type GeneratedData, type PurchaseOrder, type Supplier } from './types';

const SEED = 20260926;
const PO_COUNT = 40;
const BASE_DATE = Date.UTC(2026, 8, 1);
const DAY_MS = 86_400_000;
const CURRENCIES = ['USD', 'USD', 'USD', 'EUR', 'GBP'];

const SUPPLIER_NAMES = [
  'Northwind Components',
  'Harbor Steel Works',
  'Alder & Finch Packaging',
  'Meridian Electronics',
  'Blue Ridge Plastics',
  'Kestrel Industrial Supply',
  'Copperleaf Textiles',
  'Summit Fasteners',
];

const suppliers: Supplier[] = SUPPLIER_NAMES.map((name, i) => ({
  id: `SUP-${String(i + 1).padStart(3, '0')}`,
  name,
}));

/** The POs the owner's recorded caller clips ask about. */
const PINNED = [
  { body: '1048', status: 'shipped' },
  { body: '2093', status: 'delayed' },
] as const;

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function poCode(body: string): string {
  return `PO-${body}${checkDigit(body)}`;
}

function makePo(rand: () => number, code: string, status: PurchaseOrder['status']): PurchaseOrder {
  const orderMs = BASE_DATE + Math.floor(rand() * 60) * DAY_MS;
  const leadDays = 7 + Math.floor(rand() * 39);
  const supplierId = suppliers[Math.floor(rand() * suppliers.length)].id;
  const amountCents = 10_000 + Math.floor(rand() * 5_000_000);
  const currency = CURRENCIES[Math.floor(rand() * CURRENCIES.length)];
  const dueMs = orderMs + leadDays * DAY_MS;
  const expectedDate =
    status === 'delayed' ? isoDate(dueMs + (1 + Math.floor(rand() * 14)) * DAY_MS) : undefined;
  return {
    code,
    supplierId,
    status,
    amountCents,
    currency,
    orderDate: isoDate(orderMs),
    dueDate: isoDate(dueMs),
    ...(expectedDate ? { expectedDate } : {}),
  };
}

/** Deterministic suppliers and purchase orders: fixed seed, no clock, no Math.random. */
export function generateData(): GeneratedData {
  const rand = seededRandom(SEED);
  const bodies = new Set<string>(PINNED.map((p) => p.body));
  const purchaseOrders = PINNED.map((p) => makePo(rand, poCode(p.body), p.status));
  while (purchaseOrders.length < PO_COUNT) {
    const body = String(Math.floor(rand() * 10_000)).padStart(4, '0');
    if (bodies.has(body)) continue;
    bodies.add(body);
    const status = PO_STATUSES[purchaseOrders.length % PO_STATUSES.length];
    purchaseOrders.push(makePo(rand, poCode(body), status));
  }
  return { suppliers, purchaseOrders };
}
