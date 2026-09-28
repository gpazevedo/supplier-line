import { MeetingSessionStatusCode } from 'amazon-chime-sdk-js';
import { describe, expect, it } from 'vitest';
import { callEndedMessage, type SessionEndStatus } from './status.js';

const status = (isFailure: boolean, statusCode: MeetingSessionStatusCode): SessionEndStatus => ({
  isFailure: () => isFailure,
  statusCode: () => statusCode,
});

describe('callEndedMessage', () => {
  it('reports a plain ending when the call was not a failure', () => {
    expect(callEndedMessage(status(false, MeetingSessionStatusCode.Left))).toBe('Call ended.');
  });

  it('names rejected authentication', () => {
    expect(
      callEndedMessage(status(true, MeetingSessionStatusCode.AudioAuthenticationRejected))
    ).toBe('Call ended: could not join the call.');
  });

  it('names capacity failures', () => {
    expect(callEndedMessage(status(true, MeetingSessionStatusCode.AudioCallAtCapacity))).toBe(
      'Call ended: the line is at capacity.'
    );
  });

  it('falls back to a generic message for other failures', () => {
    expect(
      callEndedMessage(status(true, MeetingSessionStatusCode.SignalingInternalServerError))
    ).toBe('Call ended: the connection was lost.');
  });
});
