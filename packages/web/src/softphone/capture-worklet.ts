/** Posts each block of microphone samples to the page. */
class Capture extends AudioWorkletProcessor {
  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (channel) this.port.postMessage(channel.slice());
    return true;
  }
}

registerProcessor('capture', Capture);
