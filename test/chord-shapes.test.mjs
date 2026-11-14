import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MUTED,
  fitsChord,
  guitarShapes,
  isEasyShape,
  parseChord,
  pianoVoicing,
  pianoVoicings,
  soundingNotes,
  suggestCapo,
  transposeChord,
} from '../app/renderer/chord-shapes.mjs';

const ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const SUFFIXES = ['', 'm', '5', 'dim', 'aug', 'sus2', 'sus4', '6', 'm6', '7', 'm7', 'maj7', 'mMaj7', 'dim7', 'm7b5', '7sus4', 'add9', '9', 'm9', 'maj9'];

function pitchClasses(frets) {
  return new Set(soundingNotes(frets).map((note) => note % 12));
}

test('reads chord names, including slash chords', () => {
  const chord = parseChord('F#m7/E');

  assert.equal(chord.root, 6);
  assert.equal(chord.quality, 'min7');
  assert.equal(chord.bass, 4);
  assert.deepEqual(chord.pitchClasses, [6, 9, 1, 4]);
  assert.equal(parseChord('N'), null);
  assert.equal(parseChord('H7'), null);
  assert.equal(parseChord('Cmaj13').quality, 'maj');
  assert.equal(parseChord('Cmaj13').exact, false);
});

test('every chord in every key gets at least one correct guitar shape', () => {
  for (const root of ROOTS) {
    for (const suffix of SUFFIXES) {
      const label = `${root}${suffix}`;
      const chord = parseChord(label);
      const shapes = guitarShapes(label);

      assert.ok(shapes.length >= 1, `${label} has no shape`);

      for (const frets of shapes) {
        assert.ok(fitsChord(frets, chord), `${label} shape ${frets} has wrong notes`);

        const lowest = Math.min(...soundingNotes(frets));
        assert.equal(lowest % 12, chord.root, `${label} shape ${frets} has the wrong bass`);
      }
    }
  }
});

test('common chords start with the familiar open shape', () => {
  assert.deepEqual(guitarShapes('C')[0], [MUTED, 3, 2, 0, 1, 0]);
  assert.deepEqual(guitarShapes('G')[0], [3, 2, 0, 0, 0, 3]);
  assert.deepEqual(guitarShapes('D')[0], [MUTED, MUTED, 0, 2, 3, 2]);
  assert.deepEqual(guitarShapes('Am')[0], [MUTED, 0, 2, 2, 1, 0]);
  assert.deepEqual(guitarShapes('Em')[0], [0, 2, 2, 0, 0, 0]);
  assert.deepEqual(guitarShapes('E7')[0], [0, 2, 0, 1, 0, 0]);
});

test('chords without an open shape get a barre shape', () => {
  const [first] = guitarShapes('F');

  assert.deepEqual(pitchClasses(first), new Set([5, 9, 0]));
  assert.ok(!isEasyShape([1, 3, 3, 2, 1, 1]));
  assert.ok(isEasyShape([MUTED, 3, 2, 0, 1, 0]));
});

test('slash chords put the right note in the bass', () => {
  for (const label of ['D/F#', 'C/G', 'G/B', 'Am/G', 'C/E']) {
    const chord = parseChord(label);
    const shapes = guitarShapes(label);

    assert.ok(shapes.length >= 1, `${label} has no shape`);

    for (const frets of shapes) {
      assert.equal(Math.min(...soundingNotes(frets)) % 12, chord.bass, `${label} shape ${frets}`);
    }
  }
});

test('transposes chord names', () => {
  assert.equal(transposeChord('A', -2), 'G');
  assert.equal(transposeChord('F#m7', -2), 'Em7');
  assert.equal(transposeChord('Bb', -3), 'G');
  assert.equal(transposeChord('D/F#', 2), 'E/Ab');
  assert.equal(transposeChord('N', 2), 'N');
});

function chordsFor(labels) {
  return labels.map((label, index) => ({ start: index * 2, end: index * 2 + 2, label }));
}

test('suggests a capo when it turns barre chords into open ones', () => {
  assert.equal(suggestCapo(chordsFor(['Bb', 'Eb', 'F', 'Gm'])).capo, 3);
  assert.equal(suggestCapo(chordsFor(['A', 'D', 'E', 'F#m'])).capo, 2);
});

test('does not suggest a capo for songs that are already easy', () => {
  const suggestion = suggestCapo(chordsFor(['G', 'C', 'D', 'Em']));

  assert.equal(suggestion.capo, 0);
  assert.equal(suggestion.easyShare, 1);
  assert.equal(suggestCapo([]).capo, 0);
  assert.equal(suggestCapo(chordsFor(['Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G', 'Dm', 'E'])).capo, 0);
});

test('piano voicings in root position', () => {
  assert.deepEqual(pianoVoicing('C'), { left: [48], right: [60, 64, 67] });
  assert.deepEqual(pianoVoicing('Am').right, [57, 60, 64]);
  assert.deepEqual(pianoVoicing('D/F#').left, [54]);
  assert.equal(pianoVoicing('N'), null);
});

test('smooth piano voicings move as little as possible', () => {
  const [, fChord, gChord] = pianoVoicings(['C', 'F', 'G'], true);

  assert.deepEqual(fChord.right, [60, 65, 69]);
  assert.deepEqual(gChord.right, [59, 62, 67]);
});

test('nine chords on piano keep the ninth inside the hand', () => {
  const { right } = pianoVoicing('Cadd9');

  assert.deepEqual(right, [60, 62, 64, 67]);
});
