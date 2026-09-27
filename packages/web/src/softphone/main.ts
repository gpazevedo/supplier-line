import { el } from '../dom.js';
import '../style.css';
import captureUrl from './capture-worklet.ts?worker&url';
import { floatFromPcm16, pcm16FromFloat } from './pcm.js';
import playbackUrl from './playback-worklet.ts?worker&url';
import type { PlaybackCommand } from './playback-worklet.js';

/** Caller audio goes up in 32 ms frames of 16 kHz PCM, as the replay sends it. */
const FRAME_SAMPLES = 512;

const log = el('ol', 'transcript');
const say = (line: string) => log.append(el('li', '', line));

/** Agent audio through the playback worklet; its played and flushed reports go to the host. */
async function startPlayback(socket: WebSocket): Promise<(command: PlaybackCommand) => void> {
  const context = new AudioContext({ sampleRate: 24_000 });
  await context.audioWorklet.addModule(playbackUrl);
  const node = new AudioWorkletNode(context, 'playback');
  node.connect(context.destination);
  node.port.onmessage = (event) => socket.send(JSON.stringify(event.data));
  return (command) => node.port.postMessage(command);
}

/** Microphone at 16 kHz through the capture worklet, sent as binary frames. */
async function startCapture(socket: WebSocket): Promise<MediaStream> {
  const mic = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
  const context = new AudioContext({ sampleRate: 16_000 });
  await context.audioWorklet.addModule(captureUrl);
  const node = new AudioWorkletNode(context, 'capture');
  context.createMediaStreamSource(mic).connect(node);
  let frame: number[] = [];
  node.port.onmessage = (event: MessageEvent<Float32Array>) => {
    frame.push(...event.data);
    if (frame.length < FRAME_SAMPLES) return;
    if (socket.readyState === WebSocket.OPEN) socket.send(pcm16FromFloat(Float32Array.from(frame)));
    frame = [];
  };
  return mic;
}

async function call(): Promise<() => void> {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${scheme}://${location.host}/ws`);
  socket.binaryType = 'arraybuffer';
  const play = await startPlayback(socket);
  socket.onmessage = ({ data }) => {
    if (data instanceof ArrayBuffer)
      return play({ type: 'audio', samples: floatFromPcm16(new Uint8Array(data)) });
    const message = JSON.parse(data);
    if (message.type === 'turn' || message.type === 'flush') play(message);
    if (message.type === 'transcript') say(`${message.role}: ${message.text}`);
    if (message.type === 'trace') say(`Trace written: ${message.path}`);
  };
  socket.onclose = () => say('Call ended.');
  const mic = await startCapture(socket);
  return () => {
    socket.send(JSON.stringify({ type: 'end' }));
    mic.getTracks().forEach((track) => track.stop());
  };
}

const button = el('button', '', 'Call') as HTMLButtonElement;
let hangUp: (() => void) | undefined;
button.addEventListener('click', async () => {
  if (hangUp) {
    hangUp();
    hangUp = undefined;
    button.textContent = 'Call';
    return;
  }
  hangUp = await call();
  button.textContent = 'Hang up';
});

document
  .querySelector('main')
  ?.append(
    el('h1', '', 'Supplier Line softphone'),
    el('p', 'muted', 'Use headphones. Ask for the status of a purchase order.'),
    button,
    log
  );
