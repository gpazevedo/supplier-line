import {
  ConsoleLogger,
  DefaultDeviceController,
  DefaultMeetingSession,
  LogLevel,
  MeetingSessionConfiguration,
  type AudioVideoObserver,
} from 'amazon-chime-sdk-js';
import type { ConnectionData } from './api.js';

/** The slice of `DefaultMeetingSession.audioVideo` this page actually calls. */
export interface MeetingSessionLike {
  audioVideo: {
    addObserver(observer: AudioVideoObserver): void;
    listAudioInputDevices(): Promise<{ deviceId: string }[]>;
    startAudioInput(deviceId: string | null): Promise<unknown>;
    bindAudioElement(element: HTMLAudioElement): Promise<unknown>;
    start(): void;
    stop(): void;
  };
}

export type MeetingSessionFactory = (
  connectionData: ConnectionData
) => Promise<MeetingSessionLike> | MeetingSessionLike;

function defaultFactory(connectionData: ConnectionData): MeetingSessionLike {
  const logger = new ConsoleLogger('connect', LogLevel.WARN);
  const deviceController = new DefaultDeviceController(logger);
  const configuration = new MeetingSessionConfiguration(
    connectionData.Meeting,
    connectionData.Attendee
  );
  return new DefaultMeetingSession(
    configuration,
    logger,
    deviceController
  ) as unknown as MeetingSessionLike;
}

/**
 * Builds the Chime meeting session for a Connect contact. `window.__buildMeetingSession`, when
 * set, replaces the real Amazon Chime SDK call: the axe check uses it to reach an in-call state
 * without real WebRTC signalling or microphone hardware (see `a11y.test.ts`).
 */
export function buildMeetingSession(
  connectionData: ConnectionData
): Promise<MeetingSessionLike> | MeetingSessionLike {
  const override = (window as unknown as { __buildMeetingSession?: MeetingSessionFactory })
    .__buildMeetingSession;
  return (override ?? defaultFactory)(connectionData);
}
