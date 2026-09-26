import { generateData, isValidPoCode } from '../data';
import { applyDelay, type DelayOptions } from './delay';
import { normalisePoCode } from './normalise';
import { renderFailure, renderPo, type Failure, type PoView } from './render';
import { poStatusInput } from './schema';

const { suppliers, purchaseOrders } = generateData();
const supplierNames: Record<string, string> = Object.fromEntries(
  suppliers.map((s) => [s.id, s.name])
);

export interface PoStatusFound {
  ok: true;
  po: PoView;
  rendering: string;
}

export interface PoStatusFailed {
  ok: false;
  reason: Failure['reason'];
  rendering: string;
}

export type PoStatusResult = PoStatusFound | PoStatusFailed;

function failed(failure: Failure): PoStatusFailed {
  return { ok: false, reason: failure.reason, rendering: renderFailure(failure) };
}

/** Looks up a purchase order and returns it, or the reason it failed, with the sentence to speak. */
export async function getPoStatus(
  input: unknown,
  delay: DelayOptions = {}
): Promise<PoStatusResult> {
  await applyDelay(delay);
  const parsed = poStatusInput.safeParse(input);
  const code = parsed.success ? normalisePoCode(parsed.data.po_code) : null;
  if (!code) return failed({ reason: 'invalid_code' });
  if (!isValidPoCode(code)) return failed({ reason: 'check_digit_failed', code });
  const found = purchaseOrders.find((p) => p.code === code);
  if (!found) return failed({ reason: 'not_found', code });
  const { supplierId, ...rest } = found;
  const po = { ...rest, supplier: supplierNames[supplierId] };
  return { ok: true, po, rendering: renderPo(po) };
}
