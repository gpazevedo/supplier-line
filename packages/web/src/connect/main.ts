import { brandMark, el } from '../dom.js';
import '../style.css';
import { classifyCallState } from '../call-state.js';
import { startConnectCall } from './api.js';
import { createCallController } from './call.js';
import { buildMeetingSession } from './meeting.js';

/** role="status" is an implicit polite, atomic live region: call-state changes announce themselves. */
const status = el('p', 'status', 'Not on a call.');
status.setAttribute('role', 'status');
status.dataset.state = 'idle';

/** Sets the status text and, from that same text, the chip's visual state. */
function setStatus(text: string): void {
  status.textContent = text;
  status.dataset.state = classifyCallState(text);
}

const logHeading = el('h2', '', 'Call log');
logHeading.id = 'call-log-heading';
const log = el('ol', 'transcript');
log.setAttribute('aria-live', 'polite');
log.setAttribute('aria-labelledby', 'call-log-heading');
const say = (line: string) => log.append(el('li', 'log-entry', line));

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

const button = el('button', '', 'Call') as HTMLButtonElement;
button.dataset.action = 'call';

button.addEventListener(
  'click',
  createCallController({
    button,
    audio: remoteAudio,
    accessCode: () => codeInput.value,
    setStatus,
    say,
    start: startConnectCall,
    buildSession: buildMeetingSession,
  })
);

document
  .querySelector('main')
  ?.append(
    el(
      'header',
      'page-header',
      el('div', 'brand', brandMark(), el('h1', '', 'Supplier Line Connect calling')),
      el(
        'p',
        'muted',
        'Calls through Amazon Connect and its Nova Sonic speech-to-speech bot. Use headphones.'
      )
    ),
    el(
      'section',
      'panel call-card',
      el('div', 'field-row', codeLabel, codeInput),
      el('div', 'action-row', button, status)
    ),
    el('section', 'panel transcript-panel', logHeading, log),
    remoteAudio
  );
