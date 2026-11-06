import { MixEngine } from './mix-engine.mjs';

const POSITION_INTERVAL_BLOCKS = 12;

class MixerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.engine = new MixEngine();
    this.blockCount = 0;
    this.reportedEnd = false;
    this.port.onmessage = (event) => this.handleMessage(event.data);
  }

  handleMessage(message) {
    const { engine } = this;

    switch (message.type) {
      case 'load':
        engine.load(message.stems);
        this.reportedEnd = false;
        break;
      case 'gains':
        engine.setGains(message.gains);
        break;
      case 'rate':
        engine.setRate(message.rate);
        break;
      case 'loop':
        engine.setLoop(message.start, message.end);
        break;
      case 'play':
        engine.play();
        this.reportedEnd = false;
        break;
      case 'pause':
        engine.pause();
        break;
      case 'seek':
        engine.seek(message.frame);
        this.reportedEnd = false;
        break;
    }
  }

  process(_, outputs) {
    const [left, right] = outputs[0];
    this.engine.process(left, right ?? left);
    this.blockCount += 1;

    if (this.blockCount >= POSITION_INTERVAL_BLOCKS) {
      this.blockCount = 0;
      this.port.postMessage({ type: 'position', frame: this.engine.position() });
    }

    if (this.engine.ended && !this.reportedEnd) {
      this.reportedEnd = true;
      this.port.postMessage({ type: 'ended' });
    }

    return true;
  }
}

registerProcessor('mixer', MixerProcessor);
