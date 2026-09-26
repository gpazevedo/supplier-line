import type { Stack } from '@aws-sdk/client-cloudformation';
import { requireExpiresAt } from '../expiry';

export const EPHEMERAL_TAG = 'supplier-line:ephemeral';
export const MAX_AGE_MS = 8 * 60 * 60 * 1000;

/** Stack statuses that trigger an email, and the word the email uses. */
export const ALERTED_STATUSES: Record<string, string> = {
  CREATE_COMPLETE: 'created',
  DELETE_COMPLETE: 'deleted',
  DELETE_FAILED: 'delete failed',
};

function tag(stack: Stack, key: string): string | undefined {
  return stack.Tags?.find((t) => t.Key === key)?.Value;
}

/** True for stacks tagged `supplier-line:ephemeral=true`. */
export function isEphemeral(stack: Stack): boolean {
  return tag(stack, EPHEMERAL_TAG) === 'true';
}

function expiryReason(expiresAt: string | undefined, now: Date): string | undefined {
  if (expiresAt === undefined) return 'ExpiresAt tag is missing';
  try {
    requireExpiresAt(expiresAt);
  } catch {
    return `ExpiresAt tag is malformed: ${JSON.stringify(expiresAt)}`;
  }
  if (Date.parse(expiresAt) <= now.getTime()) return `ExpiresAt ${expiresAt} is past`;
  return undefined;
}

/** Why the stack must be deleted now, or undefined to keep it. */
export function deletionReason(stack: Stack, now: Date): string | undefined {
  const created = stack.CreationTime?.getTime() ?? 0;
  if (now.getTime() - created >= MAX_AGE_MS) return 'stack is older than 8 hours';
  return expiryReason(tag(stack, 'ExpiresAt'), now);
}
