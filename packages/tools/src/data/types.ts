export const PO_STATUSES = ['open', 'shipped', 'delayed', 'delivered', 'cancelled'] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

export interface Supplier {
  id: string;
  name: string;
}

export interface PurchaseOrder {
  /** `PO-NNNNN`: four body digits plus a check digit (see po-code.ts). */
  code: string;
  supplierId: string;
  status: PoStatus;
  /** Integer minor units of `currency`. */
  amountCents: number;
  /** ISO 4217 code. */
  currency: string;
  /** ISO dates, `YYYY-MM-DD`. */
  orderDate: string;
  /** The date the supplier is required to deliver. */
  dueDate: string;
  /** Present only when `status` is `delayed`; always later than `dueDate`. */
  expectedDate?: string;
}

export interface GeneratedData {
  suppliers: Supplier[];
  purchaseOrders: PurchaseOrder[];
}
