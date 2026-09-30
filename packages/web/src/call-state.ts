export type CallState = 'idle' | 'connecting' | 'active' | 'ended' | 'rejected';

/** Derives the status chip's visual state from the exact text already shown, so no new messages are introduced. */
export function classifyCallState(text: string): CallState {
  if (text.startsWith('On a call')) return 'active';
  if (text.startsWith('Calling') || text.startsWith('Connecting')) return 'connecting';
  if (text.startsWith('Call ended:') || text.startsWith('Could not start the call'))
    return 'rejected';
  if (text.startsWith('Call ended')) return 'ended';
  return 'idle';
}
