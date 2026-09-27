import { describe, expect, it } from 'vitest';
import {
  audioInput,
  closingEvents,
  resumeEvents,
  setupEvents,
  toolResultEvents,
  type SonicInputEvent,
} from './events.js';
import { CONTINUED_PROMPT, continuedPrompt, SYSTEM_PROMPT } from './prompt.js';

const ids = { prompt: 'p1', system: 's1', audio: 'a1' };
const nameOf = (e: SonicInputEvent) => Object.keys(e.event)[0];
const body = (e: SonicInputEvent) => Object.values(e.event)[0];

describe('setupEvents then resumeEvents', () => {
  const events = [...setupEvents(ids), ...resumeEvents(ids, [])];

  it('opens session, prompt, system text, then the audio container', () => {
    expect(events.map(nameOf)).toEqual([
      'sessionStart',
      'promptStart',
      'contentStart',
      'textInput',
      'contentEnd',
      'contentStart',
    ]);
  });

  it('registers get_po_status and speaks with Matthew', () => {
    expect(body(events[1])).toMatchObject({
      promptName: 'p1',
      audioOutputConfiguration: { voiceId: 'matthew' },
      toolConfiguration: { tools: [{ toolSpec: { name: 'get_po_status' } }] },
    });
  });

  it('sends the system prompt as SYSTEM text', () => {
    expect(body(events[2])).toMatchObject({ contentName: 's1', role: 'SYSTEM', type: 'TEXT' });
    expect(body(events[3])).toMatchObject({ content: SYSTEM_PROMPT });
  });

  it('opens a 16 kHz interactive USER audio container', () => {
    expect(body(events[5])).toMatchObject({
      contentName: 'a1',
      type: 'AUDIO',
      role: 'USER',
      interactive: true,
      audioInputConfiguration: { sampleRateHertz: 16000 },
    });
  });
});

it('audioInput base64-encodes PCM into the audio container', () => {
  expect(audioInput(ids, Buffer.from([1, 2, 3]))).toEqual({
    event: { audioInput: { promptName: 'p1', contentName: 'a1', content: 'AQID' } },
  });
});

it('toolResultEvents wraps the result in a TOOL content block for the toolUseId', () => {
  const [start, result, end] = toolResultEvents('p1', 't1', 'use-9', '{"ok":true}').map(body);
  expect(start).toMatchObject({
    contentName: 't1',
    type: 'TOOL',
    role: 'TOOL',
    toolResultInputConfiguration: { toolUseId: 'use-9' },
  });
  expect(result).toEqual({ promptName: 'p1', contentName: 't1', content: '{"ok":true}' });
  expect(end).toEqual({ promptName: 'p1', contentName: 't1' });
});

it('closingEvents ends audio, prompt, then session', () => {
  expect(closingEvents(ids).map(nameOf)).toEqual(['contentEnd', 'promptEnd', 'sessionEnd']);
});

describe('system prompt on codes', () => {
  const DIGIT = '(zero|one|two|three|four|five|six|seven|eight|nine)';

  it('has the agent say codes without "P O dash" and never give an example code', () => {
    expect(SYSTEM_PROMPT).toMatch(/never say "P O dash"/i);
    expect(SYSTEM_PROMPT).toMatch(/never give an example code/i);
    expect(SYSTEM_PROMPT).not.toMatch(new RegExp(`${DIGIT}( ${DIGIT}){4}`, 'i'));
    expect(SYSTEM_PROMPT).not.toMatch(/\d{5}/);
  });

  it('accepts codes said with "P O dash", with "P O", or as bare digits', () => {
    expect(SYSTEM_PROMPT).toMatch(/"P O dash".*"P O".*just the digits/);
  });

  it('tells the model to wait when a lookup is held because the caller is still reading', () => {
    expect(SYSTEM_PROMPT).toMatch(/caller_still_reading.*wait/);
  });
});

it('system prompt tells the model to speak the rendering exactly', () => {
  expect(SYSTEM_PROMPT).toMatch(/get_po_status/);
  expect(SYSTEM_PROMPT).toMatch(/rendering/);
  expect(SYSTEM_PROMPT).toMatch(/exactly/i);
});

it('setupEvents sends the given system prompt', () => {
  expect(body(setupEvents(ids, CONTINUED_PROMPT)[3])).toMatchObject({ content: CONTINUED_PROMPT });
});

it('a continued connection is told PO answers were left out and must be looked up again', () => {
  expect(CONTINUED_PROMPT.startsWith(SYSTEM_PROMPT)).toBe(true);
  expect(CONTINUED_PROMPT.slice(SYSTEM_PROMPT.length)).toMatch(/left out.*get_po_status/s);
});

it('names the order found last in a continued connection, so follow-ups keep it', () => {
  expect(continuedPrompt('PO-10482')).toBe(
    `${CONTINUED_PROMPT} The order discussed most recently is purchase order one zero four eight two.`
  );
  expect(continuedPrompt(undefined)).toBe(CONTINUED_PROMPT);
});

it('resumeEvents replays history as non-interactive TEXT blocks before the audio container', () => {
  const events = resumeEvents(ids, [
    { role: 'USER', text: 'Status of PO-10482?' },
    { role: 'ASSISTANT', text: 'It has shipped.' },
  ]);
  expect(events.map(nameOf)).toEqual([
    ...['contentStart', 'textInput', 'contentEnd'],
    ...['contentStart', 'textInput', 'contentEnd'],
    'contentStart',
  ]);
  const [userStart, userText, userEnd, assistantStart] = events.map(body);
  expect(userStart).toMatchObject({
    promptName: 'p1',
    type: 'TEXT',
    role: 'USER',
    interactive: false,
  });
  expect(userText).toEqual({
    promptName: 'p1',
    contentName: userStart.contentName,
    content: 'Status of PO-10482?',
  });
  expect(userEnd).toEqual({ promptName: 'p1', contentName: userStart.contentName });
  expect(assistantStart).toMatchObject({ role: 'ASSISTANT' });
  expect(assistantStart.contentName).not.toBe(userStart.contentName);
  expect(body(events[6])).toMatchObject({ contentName: 'a1', type: 'AUDIO', interactive: true });
});
