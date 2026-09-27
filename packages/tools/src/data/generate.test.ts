import { describe, expect, it } from 'vitest';
import { renderDate, renderMoney, renderPoCode } from '../render';
import golden from './golden/data.json';
import { generateData } from './generate';
import { isValidPoCode } from './po-code';
import { PO_STATUSES } from './types';

describe('generateData', () => {
  it('is deterministic', () => {
    expect(generateData()).toEqual(generateData());
  });

  it('contains the two recorded POs with distinct statuses', () => {
    const { purchaseOrders } = generateData();
    const a = purchaseOrders.find((po) => po.code === 'PO-10482');
    const b = purchaseOrders.find((po) => po.code === 'PO-20931');
    expect(a?.status).toBe('shipped');
    expect(b?.status).toBe('delayed');
  });
});

describe('every generated PO', () => {
  const { suppliers, purchaseOrders } = generateData();

  it('has a valid code, and every single wrong digit fails validation', () => {
    for (const { code } of purchaseOrders) {
      expect(isValidPoCode(code)).toBe(true);
      for (let i = 3; i < code.length; i++) {
        for (const d of '0123456789'.replace(code[i], '')) {
          expect(isValidPoCode(code.slice(0, i) + d + code.slice(i + 1))).toBe(false);
        }
      }
    }
  });

  it('has a unique code and a known supplier', () => {
    const ids = new Set(suppliers.map((s) => s.id));
    expect(new Set(purchaseOrders.map((po) => po.code)).size).toBe(purchaseOrders.length);
    expect(purchaseOrders.every((po) => ids.has(po.supplierId))).toBe(true);
  });

  it('covers every status', () => {
    expect(new Set(purchaseOrders.map((po) => po.status))).toEqual(new Set(PO_STATUSES));
  });

  it('renders with the S03 functions', () => {
    for (const po of purchaseOrders) {
      expect(() => renderPoCode(po.code)).not.toThrow();
      expect(() => renderMoney(po.amountCents, po.currency)).not.toThrow();
      expect(() => renderDate(po.orderDate)).not.toThrow();
      expect(() => renderDate(po.dueDate)).not.toThrow();
      expect(po.dueDate > po.orderDate).toBe(true);
    }
  });

  it('gives every delayed PO an expected date later than its due date, and no other status one', () => {
    for (const po of purchaseOrders) {
      if (po.status === 'delayed') {
        const { expectedDate } = po;
        if (!expectedDate) throw new Error(`delayed PO ${po.code} has no expectedDate`);
        expect(() => renderDate(expectedDate)).not.toThrow();
        expect(expectedDate > po.dueDate).toBe(true);
      } else {
        expect(po.expectedDate).toBeUndefined();
      }
    }
  });
});

describe('golden data', () => {
  it('matches the committed file', () => {
    expect(generateData()).toEqual(golden);
  });
});
