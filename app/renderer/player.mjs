const SAMPLE_RATE = 44100;

export class Player {
  constructor({ onPosition, onEnded }) {
    this.onPosition = onPosition;
    this.onEnded = onEnded;
    this.context = null;
    this.node = null;
  }

  async init() {
    this.context = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'playback' });
    await this.context.audioWorklet.addModule('mixer-worklet.mjs');

    this.node = new AudioWorkletNode(this.context, 'mixer', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });

    this.node.connect(this.context.destination);

    this.node.port.onmessage = ({ data }) => {
      if (data.type === 'position') {
        this.onPosition(data.frame / SAMPLE_RATE);
      } else if (data.type === 'ended') {
        this.onEnded();
      }
    };
  }

  async decode(bytes) {
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const audio = await this.context.decodeAudioData(copy);
    const left = audio.getChannelData(0).slice();
    const right = audio.numberOfChannels > 1 ? audio.getChannelData(1).slice() : left;

    return { left, right };
  }

  load(stems) {
    const transfers = stems.flatMap(({ left, right }) =>
      left === right ? [left.buffer] : [left.buffer, right.buffer],
    );

    this.send({ type: 'load', stems }, transfers);
  }

  play() {
    this.context.resume();
    this.send({ type: 'play' });
  }

  pause() {
    this.send({ type: 'pause' });
  }

  seek(seconds) {
    this.send({ type: 'seek', frame: Math.round(seconds * SAMPLE_RATE) });
  }

  setGains(gains) {
    this.send({ type: 'gains', gains });
  }

  setRate(rate) {
    this.send({ type: 'rate', rate });
  }

  setLoop(startSeconds, endSeconds) {
    this.send({
      type: 'loop',
      start: startSeconds === null ? null : Math.round(startSeconds * SAMPLE_RATE),
      end: endSeconds === null ? null : Math.round(endSeconds * SAMPLE_RATE),
    });
  }

  send(message, transfers = []) {
    this.node.port.postMessage(message, transfers);
  }
}

export function computePeaks({ left, right }, bucketCount) {
  const minimums = new Float32Array(bucketCount);
  const maximums = new Float32Array(bucketCount);
  const bucketSize = left.length / bucketCount;

  for (let bucket = 0; bucket < bucketCount; bucket++) {
    const first = Math.floor(bucket * bucketSize);
    const last = Math.floor((bucket + 1) * bucketSize);
    let low = 0;
    let high = 0;

    for (let i = first; i < last; i++) {
      const sample = (left[i] + right[i]) / 2;

      if (sample < low) {
        low = sample;
      }

      if (sample > high) {
        high = sample;
      }
    }

    minimums[bucket] = low;
    maximums[bucket] = high;
  }

  return { minimums, maximums };
}
