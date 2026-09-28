import { el } from '../dom.js';
import '../style.css';
import { startConnectCall } from './api.js';
import { buildMeetingSession } from './meeting.js';
import { callEndedMessage } from './status.js';

/** role="status" is an implicit polite, atomic live region: call-state changes announce themselves. */
const status = el('p', 'status', 'Not on a call.');
status.setAttribute('role', 'status');

const logHeading = el('h2', '', 'Call log');
logHeading.id = 'call-log-heading';
const log = el('ol', 'transcript');
log.setAttribute('aria-live', 'polite');
log.setAttribute('aria-labelledby', 'call-log-heading');
const say = (line: string) => log.append(el('li', '', line));

/** Bound to the Chime session so the agent's audio plays; not shown, since it has no user controls. */
const remoteAudio = document.createElement('audio');
remoteAudio.hidden = true;
remoteAudio.autoplay = true;

const codeLabel = el('label', '', 'Access code') as HTMLLabelElement;
codeLabel.htmlFor = 'access-code';
const codeInput = document.createElement('input');
codeInput.type = 'password';
codeInput.id = 'access-code';
codeInput.autocomplete = 'off';

/** A closure that ends the call in progress; cleared once the session actually stops. */
let hangUp: (() => void) | undefined;
const button = el('button', '', 'Call') as HTMLButtonElement;

async function call(): Promise<void> {
  button.disabled = true;
  status.textContent = 'Calling…';
  say('Calling…');
  try {
    const { connectionData } = await startConnectCall(codeInput.value);
    const session = await buildMeetingSession(connectionData);
    session.audioVideo.addObserver({
      audioVideoDidStart: () => {
        status.textContent = 'On a call. Ask for the status of a purchase order.';
        say('Connected.');
      },
      audioVideoDidStop: (sessionStatus) => {
        hangUp = undefined;
        button.textContent = 'Call';
        button.disabled = false;
        const message = callEndedMessage(sessionStatus);
        status.textContent = message;
        say(message);
      },
    });
    const mics = await session.audioVideo.listAudioInputDevices();
    await session.audioVideo.startAudioInput(mics[0]?.deviceId ?? null);
    await session.audioVideo.bindAudioElement(remoteAudio);
    session.audioVideo.start();
    hangUp = () => session.audioVideo.stop();
    button.textContent = 'Hang up';
    button.disabled = false;
  } catch (error) {
    const message = `Could not start the call: ${(error as Error).message}`;
    status.textContent = message;
    say(message);
    button.textContent = 'Call';
    button.disabled = false;
  }
}

button.addEventListener('click', () => {
  if (hangUp) hangUp();
  else void call();
});

document
  .querySelector('main')
  ?.append(
    el('h1', '', 'Supplier Line Connect calling'),
    el(
      'p',
      'muted',
      'Calls through Amazon Connect and its Nova Sonic speech-to-speech bot. Use headphones.'
    ),
    codeLabel,
    codeInput,
    button,
    status,
    logHeading,
    log,
    remoteAudio
  );
