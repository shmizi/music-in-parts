import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MixEngine, LATENCY_FRAMES } from '../app/renderer/mix-engine.mjs';

const SAMPLE_RATE = 44100;
const BLOCK = 128;

function sine(frequency, seconds, amplitude = 0.5) {
  const samples = new Float32Array(Math.floor(seconds * SAMPLE_RATE));

  for (let i = 0; i < samples.length; i++) {
    samples[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE);
  }

  return samples;
}

function stem(samples) {
  return { left: samples, right: samples };
}

function render(engine, maxSeconds) {
  const output = [];
  const left = new Float32Array(BLOCK);
  const right = new Float32Array(BLOCK);
  const maxBlocks = Math.ceil((maxSeconds * SAMPLE_RATE) / BLOCK);

  for (let block = 0; block < maxBlocks && !engine.ended; block++) {
    engine.process(left, right);
    output.push(...left);
  }

  return Float32Array.from(output);
}

function dominantFrequency(samples) {
  let crossings = 0;

  for (let i = 1; i < samples.length; i++) {
    if (samples[i - 1] <= 0 && samples[i] > 0) {
      crossings += 1;
    }
  }

  return (crossings * SAMPLE_RATE) / samples.length;
}

test('at normal speed the output is the exact sum of the stems', () => {
  const first = sine(220, 1);
  const second = sine(550, 1, 0.25);
  const engine = new MixEngine();

  engine.load([stem(first), stem(second)]);
  engine.play();

  const output = render(engine, 2);

  for (let i = 2000; i < first.length; i += 7) {
    const expected = first[i] + second[i];
    assert.ok(Math.abs(output[i + LATENCY_FRAMES] - expected) < 1e-4, `sample ${i}`);
  }
});

test('muting a stem removes it from the mix', () => {
  const first = sine(220, 1);
  const second = sine(550, 1);
  const engine = new MixEngine();

  engine.load([stem(first), stem(second)]);
  engine.setGains([1, 0]);
  engine.play();

  const output = render(engine, 2);

  for (let i = 2000; i < first.length; i += 7) {
    assert.ok(Math.abs(output[i + LATENCY_FRAMES] - first[i]) < 1e-4, `sample ${i}`);
  }
});

test('half speed takes twice as long and keeps the pitch', () => {
  const engine = new MixEngine();

  engine.load([stem(sine(440, 2))]);
  engine.setRate(0.5);
  engine.play();

  const output = render(engine, 8);
  const seconds = output.length / SAMPLE_RATE;

  assert.ok(engine.ended);
  assert.ok(Math.abs(seconds - 4) < 0.3, `took ${seconds} s`);

  const middle = output.subarray(SAMPLE_RATE, 3 * SAMPLE_RATE);
  const frequency = dominantFrequency(middle);

  assert.ok(Math.abs(frequency - 440) < 5, `pitch was ${frequency} Hz`);
});

test('a loop keeps playback inside the selected range', () => {
  const engine = new MixEngine();
  const start = SAMPLE_RATE;
  const end = 2 * SAMPLE_RATE;

  engine.load([stem(sine(220, 5))]);
  engine.setLoop(start, end);
  engine.seek(start);
  engine.play();

  const left = new Float32Array(BLOCK);
  const right = new Float32Array(BLOCK);
  let latest = 0;

  for (let block = 0; block < (6 * SAMPLE_RATE) / BLOCK; block++) {
    engine.process(left, right);
    latest = engine.position();

    if (block > 1000) {
      assert.ok(latest >= start - 8192 && latest <= end + 8192, `position ${latest}`);
    }
  }

  assert.equal(engine.ended, false);
});

test('playback reports the end of the song and can restart', () => {
  const engine = new MixEngine();

  engine.load([stem(sine(220, 0.5))]);
  engine.play();
  render(engine, 2);

  assert.ok(engine.ended);

  engine.play();
  assert.equal(engine.ended, false);
  assert.ok(engine.position() < SAMPLE_RATE / 10);
});
