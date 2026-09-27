import { renderDate, renderMoney, renderPoCode } from '../render';
import type { PoStatus, PurchaseOrder } from '../data';

export interface PoView extends Omit<PurchaseOrder, 'supplierId'> {
  supplier: string;
}

const STATUS_PHRASE: Record<PoStatus, string> = {
  open: 'is open',
  shipped: 'has shipped',
  delayed: 'is delayed',
  delivered: 'was delivered',
  cancelled: 'was cancelled',
};

/** Delivery sentence(s) following "It was ordered on <date>", including the closing period. */
function deliverySentence(po: PoView): string {
  const due = renderDate(po.dueDate);
  switch (po.status) {
    case 'cancelled':
      return '.';
    case 'delivered':
      return `, and delivered on ${due}.`;
    case 'delayed': {
      const { expectedDate } = po;
      if (!expectedDate) throw new RangeError(`delayed PO ${po.code} has no expectedDate`);
      return `. Delivery was due on ${due} and is now expected on ${renderDate(expectedDate)}.`;
    }
    case 'open':
    case 'shipped':
      return `, and delivery is due on ${due}.`;
  }
}

/** The exact en-US sentence the agent speaks for a found PO. */
export function renderPo(po: PoView): string {
  return (
    `Purchase order ${renderPoCode(po.code)} from ${po.supplier} ${STATUS_PHRASE[po.status]}. ` +
    `The amount is ${renderMoney(po.amountCents, po.currency)}. ` +
    `It was ordered on ${renderDate(po.orderDate)}${deliverySentence(po)}`
  );
}

export type Failure =
  { reason: 'invalid_code' } | { reason: 'check_digit_failed' | 'not_found'; code: string };

const SAY_AGAIN = 'Could you say it again, one digit at a time?';

/** The spoken apology for a failed lookup; `code` is the normalised code when there is one. */
export function renderFailure(failure: Failure): string {
  switch (failure.reason) {
    case 'invalid_code':
      return `Sorry, I didn't catch a purchase order code. ${SAY_AGAIN}`;
    case 'check_digit_failed':
      return `Sorry, purchase order ${renderPoCode(failure.code)} doesn't look like a valid purchase order code. ${SAY_AGAIN}`;
    case 'not_found':
      return (
        `Sorry, I couldn't find purchase order ${renderPoCode(failure.code)}. ` +
        'Could you check the number and say it again?'
      );
  }
}
