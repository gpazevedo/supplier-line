import { describe, expect, it } from 'vitest';
import {
  audioInput,
  closingEvents,
  openingEvents,
  toolResultEvents,
  type SonicInputEvent,
} from './events.js';
import { SYSTEM_PROMPT } from './prompt.js';

const ids = { prompt: 'p1', system: 's1', audio: 'a1' };
const nameOf = (e: SonicInputEvent) => Object.keys(e.event)[0];
const body = (e: SonicInputEvent) => Object.values(e.event)[0];

describe('openingEvents', () => {
  const events = openingEvents(ids);

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

it('system prompt tells the model to speak the rendering exactly', () => {
  expect(SYSTEM_PROMPT).toMatch(/get_po_status/);
  expect(SYSTEM_PROMPT).toMatch(/rendering/);
  expect(SYSTEM_PROMPT).toMatch(/exactly/i);
});
