import { z } from 'zod';
import type { DelayOptions } from './delay';
import { getPoStatus } from './handler';
import { poStatusInput } from './schema';

const { $schema: _, ...shared } = z.toJSONSchema(poStatusInput);

/**
 * The shared schema, tightened for Sonic: the code must be PO- and five digits, and no real code
 * is given as an example, since the model copies examples into what it hears.
 */
const inputSchema = {
  ...shared,
  properties: {
    po_code: {
      type: 'string',
      pattern: '^PO-[0-9]{5}$',
      description: 'PO- followed by the five digits the caller said, digit for digit',
    },
  },
};

/** Nova 2 Sonic `toolConfiguration.tools` entry; the schema is derived from the Zod input. */
export const getPoStatusToolSpec = {
  toolSpec: {
    name: 'get_po_status',
    description:
      'Look up a purchase order by its code and return its status, amount and dates, ' +
      'plus the exact sentence to speak to the caller. Call it only once the caller has said ' +
      'all five digits of the code.',
    inputSchema: { json: JSON.stringify(inputSchema) },
  },
};

function parseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

/** Maps a Sonic toolUse event's `content` (JSON string) to the toolResult `content` (JSON string). */
export async function toolUseToResult(content: string, delay?: DelayOptions): Promise<string> {
  return JSON.stringify(await getPoStatus(parseJson(content), delay));
}
