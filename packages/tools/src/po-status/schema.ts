import { z } from 'zod';

/** Tool input: the PO code as the caller said it, e.g. "PO-10482" or "P O one zero four eight two". */
export const poStatusInput = z.object({
  po_code: z.string().describe('The purchase order code the caller gave, e.g. PO-10482'),
});

export type PoStatusInput = z.infer<typeof poStatusInput>;
