// @vitest-environment happy-dom
import { MeetingSessionStatusCode } from 'amazon-chime-sdk-js';
import type { AudioVideoObserver } from 'amazon-chime-sdk-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCallController } from './call.js';
import type { SessionEndStatus } from './status.js';

const data = { Meeting: {}, Attendee: {} };
const ended = (isFailure: boolean, code: MeetingSessionStatusCode): SessionEndStatus => ({
  isFailure: () => isFailure,
  statusCode: () => code,
});

function setup(start = vi.fn().mockResolvedValue({ connectionData: data })) {
  let observer!: AudioVideoObserver;
  const audioVideo = {
    addObserver: (o: AudioVideoObserver) => (observer = o),
    listAudioInputDevices: async () => [{ deviceId: 'mic-1' }],
    startAudioInput: vi.fn().mockResolvedValue(undefined),
    bindAudioElement: vi.fn().mockResolvedValue(undefined),
    start: vi.fn(),
    stop: vi.fn(),
  };
  const button = document.createElement('button');
  const statuses: string[] = [];
  const log: string[] = [];
  const click = createCallController({
    button,
    audio: document.createElement('audio'),
    accessCode: () => 'code',
    setStatus: (t) => statuses.push(t),
    say: (l) => log.push(l),
    start,
    buildSession: () => ({ audioVideo }),
  });
  const press = async () => {
    click();
    await vi.waitFor(() => expect(button.disabled).toBe(false));
  };
  return { button, statuses, log, press, audioVideo, observer: () => observer, start };
}

describe('Connect call controller', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => (t = setup()));

  it('starts a call: button becomes Hang up and the session starts', async () => {
    await t.press();
    expect(t.button.textContent).toBe('Hang up');
    expect(t.button.dataset.action).toBe('hangup');
    expect(t.audioVideo.start).toHaveBeenCalledOnce();
    expect(t.statuses).toEqual(['Calling…']);
  });

  it('reports connected, then hangs up and ends cleanly', async () => {
    await t.press();
    t.observer().audioVideoDidStart?.();
    expect(t.statuses.at(-1)).toMatch(/^On a call/);

    await t.press();
    expect(t.audioVideo.stop).toHaveBeenCalledOnce();

    t.observer().audioVideoDidStop?.(ended(false, MeetingSessionStatusCode.Left) as never);
    expect(t.button.textContent).toBe('Call');
    expect(t.statuses.at(-1)).toBe('Call ended.');
    expect(t.log.at(-1)).toBe('Call ended.');
  });

  it.each([
    [MeetingSessionStatusCode.AudioAuthenticationRejected, 'Call ended: could not join the call.'],
    [MeetingSessionStatusCode.AudioCallAtCapacity, 'Call ended: the line is at capacity.'],
    [MeetingSessionStatusCode.AudioDisconnected, 'Call ended: the connection was lost.'],
  ])('shows the end message for failure status %s', async (code, message) => {
    await t.press();
    t.observer().audioVideoDidStop?.(ended(true, code) as never);
    expect(t.statuses.at(-1)).toBe(message);
  });

  it('calls again after the session stops', async () => {
    await t.press();
    t.observer().audioVideoDidStop?.(ended(false, MeetingSessionStatusCode.Left) as never);
    await t.press();
    expect(t.start).toHaveBeenCalledTimes(2);
    expect(t.audioVideo.start).toHaveBeenCalledTimes(2);
    expect(t.button.dataset.action).toBe('hangup');
  });

  it('re-enables the button when start rejects', async () => {
    const failing = setup(vi.fn().mockRejectedValue(new Error('Wrong access code')));
    await failing.press();
    expect(failing.button.disabled).toBe(false);
    expect(failing.button.dataset.action).toBe('call');
    expect(failing.statuses.at(-1)).toBe('Could not start the call: Wrong access code');
    expect(failing.log.at(-1)).toBe(failing.statuses.at(-1));
  });
});
