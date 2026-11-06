// grain length in samples, about 93 ms at 44.1 kHz
const GRAIN_SIZE = 4096;

// output step between grains; half a grain gives a constant-sum Hann overlap
const HOP = GRAIN_SIZE / 2;

// how far either side of the nominal position to look for the best match, in samples
const SEARCH_RADIUS = 512;

// samples skipped while comparing waveforms, to keep the search cheap
const SEARCH_STEP = 4;

// samples compared at each candidate position
const SEARCH_LENGTH = 1024;

// per-sample change of the play/pause fade, about 6 ms from silent to full
const FADE_STEP = 1 / 256;

function createHannWindow(size) {
  const window = new Float32Array(size);

  for (let i = 0; i < size; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  }

  return window;
}

export class MixEngine {
  constructor() {
    this.hann = createHannWindow(GRAIN_SIZE);
    this.overlapLeft = new Float32Array(GRAIN_SIZE);
    this.overlapRight = new Float32Array(GRAIN_SIZE);
    this.grainLeft = new Float32Array(GRAIN_SIZE);
    this.grainRight = new Float32Array(GRAIN_SIZE);
    this.stems = [];
    this.gains = [];
    this.length = 0;
    this.rate = 1;
    this.loopStart = null;
    this.loopEnd = null;
    this.playing = false;
    this.ended = false;

    // fade: output level from 0 to 1, used to avoid clicks on play and pause
    this.fade = 0;

    this.reset(0);
  }

  load(stems) {
    this.stems = stems;
    this.gains = stems.map(() => 1);
    this.length = stems.reduce((longest, stem) => Math.max(longest, stem.left.length), 0);
    this.playing = false;
    this.fade = 0;
    this.loopStart = null;
    this.loopEnd = null;
    this.reset(0);
  }

  reset(frame) {
    this.overlapLeft.fill(0);
    this.overlapRight.fill(0);

    // nominalPosition: where the next grain should start in the song, in samples
    this.nominalPosition = frame - HOP;

    // grainPosition: where the latest grain actually started, in samples
    this.grainPosition = frame - HOP;

    // readIndex: samples already played from the current hop; HOP means a new grain is due
    this.readIndex = HOP;

    this.hasPreviousGrain = false;
    this.drainGrains = 0;
    this.ended = false;
  }

  setGains(gains) {
    this.gains = gains;
  }

  setRate(rate) {
    this.rate = rate;
  }

  setLoop(startFrame, endFrame) {
    this.loopStart = startFrame;
    this.loopEnd = endFrame;
  }

  play() {
    if (this.ended || this.position() >= this.length) {
      this.reset(this.loopStart ?? 0);
    }

    this.playing = true;
  }

  pause() {
    this.playing = false;
  }

  seek(frame) {
    const target = Math.max(0, Math.min(frame, this.length));

    if (this.fade === 0) {
      this.reset(target);
      return;
    }

    this.nominalPosition = target;
    this.hasPreviousGrain = false;
    this.drainGrains = 0;
    this.ended = false;
  }

  position() {
    return Math.max(0, Math.min(this.grainPosition + this.readIndex, this.length));
  }

  mixGrain(start) {
    this.grainLeft.fill(0);
    this.grainRight.fill(0);

    for (let s = 0; s < this.stems.length; s++) {
      const gain = this.gains[s] ?? 0;

      if (gain === 0) {
        continue;
      }

      const { left, right } = this.stems[s];
      const first = Math.max(0, -start);
      const last = Math.min(GRAIN_SIZE, left.length - start);

      for (let i = first; i < last; i++) {
        this.grainLeft[i] += left[start + i] * gain;
        this.grainRight[i] += right[start + i] * gain;
      }
    }
  }

  monoSample(frame) {
    let sum = 0;

    for (let s = 0; s < this.stems.length; s++) {
      const gain = this.gains[s] ?? 0;
      const { left, right } = this.stems[s];

      if (gain !== 0 && frame >= 0 && frame < left.length) {
        sum += (left[frame] + right[frame]) * gain;
      }
    }

    return sum;
  }

  findBestStart(nominal, natural) {
    const compareCount = Math.floor(SEARCH_LENGTH / SEARCH_STEP);
    const reference = new Float32Array(compareCount);

    for (let i = 0; i < compareCount; i++) {
      reference[i] = this.monoSample(natural + i * SEARCH_STEP);
    }

    const spanStart = nominal - SEARCH_RADIUS;
    const spanCount = compareCount + Math.floor((2 * SEARCH_RADIUS) / SEARCH_STEP);
    const span = new Float32Array(spanCount);

    for (let i = 0; i < spanCount; i++) {
      span[i] = this.monoSample(spanStart + i * SEARCH_STEP);
    }

    let bestOffset = 0;
    let bestScore = -Infinity;

    for (let offset = 0; offset + compareCount <= spanCount; offset++) {
      let correlation = 0;
      let energy = 1e-9;

      for (let i = 0; i < compareCount; i++) {
        correlation += reference[i] * span[offset + i];
        energy += span[offset + i] * span[offset + i];
      }

      const score = correlation / Math.sqrt(energy);

      if (score > bestScore) {
        bestScore = score;
        bestOffset = offset;
      }
    }

    return spanStart + bestOffset * SEARCH_STEP;
  }

  nextGrainStart() {
    const nominal = Math.round(this.nominalPosition);

    if (this.rate === 1 || !this.hasPreviousGrain) {
      return nominal;
    }

    return this.findBestStart(nominal, this.grainPosition + HOP);
  }

  advanceNominal() {
    this.nominalPosition += HOP * this.rate;

    const looping = this.loopEnd !== null && this.loopStart !== null;

    if (looping && this.nominalPosition >= this.loopEnd) {
      this.nominalPosition = this.loopStart;
      this.hasPreviousGrain = false;
      return;
    }

    if (this.nominalPosition >= this.length) {
      this.drainGrains += 1;
    }
  }

  generateHop() {
    this.overlapLeft.copyWithin(0, HOP);
    this.overlapRight.copyWithin(0, HOP);
    this.overlapLeft.fill(0, HOP);
    this.overlapRight.fill(0, HOP);

    const start = this.nextGrainStart();
    this.mixGrain(start);

    for (let i = 0; i < GRAIN_SIZE; i++) {
      this.overlapLeft[i] += this.grainLeft[i] * this.hann[i];
      this.overlapRight[i] += this.grainRight[i] * this.hann[i];
    }

    this.grainPosition = start;
    this.hasPreviousGrain = true;
    this.readIndex = 0;

    this.advanceNominal();

    if (this.drainGrains > 2) {
      this.ended = true;
      this.playing = false;
      this.fade = 0;
    }
  }

  process(outLeft, outRight) {
    for (let i = 0; i < outLeft.length; i++) {
      if (this.playing) {
        this.fade = Math.min(1, this.fade + FADE_STEP);
      } else {
        this.fade = Math.max(0, this.fade - FADE_STEP);
      }

      if (this.fade === 0) {
        outLeft[i] = 0;
        outRight[i] = 0;
        continue;
      }

      if (this.readIndex >= HOP) {
        this.generateHop();
      }

      outLeft[i] = this.overlapLeft[this.readIndex] * this.fade;
      outRight[i] = this.overlapRight[this.readIndex] * this.fade;
      this.readIndex += 1;
    }
  }
}

export const LATENCY_FRAMES = HOP;
