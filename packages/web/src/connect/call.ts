import type { ConnectionData } from './api.js';
import type { MeetingSessionLike } from './meeting.js';
import { callEndedMessage } from './status.js';

/** What the call controller needs from the page and the network; tests pass fakes. */
export interface CallDeps {
  button: HTMLButtonElement;
  audio: HTMLAudioElement;
  accessCode: () => string;
  setStatus: (text: string) => void;
  say: (line: string) => void;
  start: (accessCode: string) => Promise<{ connectionData: ConnectionData }>;
  buildSession: (data: ConnectionData) => Promise<MeetingSessionLike> | MeetingSessionLike;
}

/** Returns the button's click handler: starts a call, or hangs up the one in progress. */
export function createCallController(deps: CallDeps): () => void {
  const { button, audio, setStatus, say } = deps;
  let hangUp: (() => void) | undefined;

  const showButton = (action: 'call' | 'hangup') => {
    button.textContent = action === 'call' ? 'Call' : 'Hang up';
    button.dataset.action = action;
    button.disabled = false;
  };

  async function call(): Promise<void> {
    button.disabled = true;
    setStatus('Calling…');
    say('Calling…');
    try {
      const { connectionData } = await deps.start(deps.accessCode());
      const session = await deps.buildSession(connectionData);
      session.audioVideo.addObserver({
        audioVideoDidStart: () => {
          setStatus('On a call. Ask for the status of a purchase order.');
          say('Connected.');
        },
        audioVideoDidStop: (sessionStatus) => {
          hangUp = undefined;
          showButton('call');
          const message = callEndedMessage(sessionStatus);
          setStatus(message);
          say(message);
        },
      });
      const mics = await session.audioVideo.listAudioInputDevices();
      await session.audioVideo.startAudioInput(mics[0]?.deviceId ?? null);
      await session.audioVideo.bindAudioElement(audio);
      session.audioVideo.start();
      hangUp = () => session.audioVideo.stop();
      showButton('hangup');
    } catch (error) {
      const message = `Could not start the call: ${(error as Error).message}`;
      setStatus(message);
      say(message);
      showButton('call');
    }
  }

  return () => {
    if (hangUp) hangUp();
    else void call();
  };
}
