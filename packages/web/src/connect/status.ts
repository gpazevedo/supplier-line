import { MeetingSessionStatusCode } from 'amazon-chime-sdk-js';

/** The `MeetingSessionStatus` passed to `AudioVideoObserver.audioVideoDidStop`. */
export interface SessionEndStatus {
  isFailure(): boolean;
  statusCode(): MeetingSessionStatusCode;
}

/** The line shown in the call log and status region when the Chime session ends. */
export function callEndedMessage(status: SessionEndStatus): string {
  if (!status.isFailure()) return 'Call ended.';
  switch (status.statusCode()) {
    case MeetingSessionStatusCode.AudioAuthenticationRejected:
      return 'Call ended: could not join the call.';
    case MeetingSessionStatusCode.AudioCallAtCapacity:
      return 'Call ended: the line is at capacity.';
    default:
      return 'Call ended: the connection was lost.';
  }
}
