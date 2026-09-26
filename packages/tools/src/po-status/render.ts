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

/** Delivery clause, or none when the PO was cancelled. */
function deliveryClause(po: PoView): string {
  const date = renderDate(po.deliveryDate);
  if (po.status === 'cancelled') return '';
  if (po.status === 'delivered') return `, and delivered on ${date}`;
  return `, and delivery is expected on ${date}`;
}

/** The exact en-US sentence the agent speaks for a found PO. */
export function renderPo(po: PoView): string {
  return (
    `Purchase order ${renderPoCode(po.code)} from ${po.supplier} ${STATUS_PHRASE[po.status]}. ` +
    `The amount is ${renderMoney(po.amountCents, po.currency)}. ` +
    `It was ordered on ${renderDate(po.orderDate)}${deliveryClause(po)}.`
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
      return `Sorry, ${renderPoCode(failure.code)} doesn't look like a valid purchase order code. ${SAY_AGAIN}`;
    case 'not_found':
      return (
        `Sorry, I couldn't find purchase order ${renderPoCode(failure.code)}. ` +
        'Could you check the number and say it again?'
      );
  }
}
