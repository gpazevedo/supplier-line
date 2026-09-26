import type { LexV2Event, LexV2Result } from 'aws-lambda';
import type { DelayOptions } from './delay';
import { getPoStatus } from './handler';

const DIGITS_SLOT = 'PoDigits';

/**
 * Lex V2 fulfillment for the PoStatus intent. The `PoDigits` slot holds the digits after "PO";
 * the reply message is the rendering, and the intent is Failed when the lookup fails.
 */
export async function lexFulfillment(
  event: LexV2Event,
  delay?: DelayOptions
): Promise<LexV2Result> {
  const { intent, sessionAttributes } = event.sessionState;
  const digits = intent.slots?.[DIGITS_SLOT]?.value?.interpretedValue ?? '';
  const result = await getPoStatus({ po_code: `PO ${digits}` }, delay);
  return {
    sessionState: {
      dialogAction: { type: 'Close' },
      intent: { name: intent.name, slots: intent.slots, state: result.ok ? 'Fulfilled' : 'Failed' },
      sessionAttributes,
    },
    messages: [{ contentType: 'PlainText', content: result.rendering }],
  };
}

/** Lambda entry point for S10 to bundle. */
export const handler = (event: LexV2Event): Promise<LexV2Result> => lexFulfillment(event);
