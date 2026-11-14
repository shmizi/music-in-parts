import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BASS_STRINGS,
  GUITAR_STRINGS,
  assignFrets,
  barEdges,
  buildNoteNames,
  buildTab,
  groupNotes,
  noteLabel,
} from '../app/renderer/tab.mjs';

function note(start, pitch, length = 0.25) {
  return [start, start + length, pitch, 0.8];
}

test('names notes with their octave', () => {
  assert.equal(noteLabel(60), 'C4');
  assert.equal(noteLabel(69), 'A4');
  assert.equal(noteLabel(40), 'E2');
});

test('groups notes that start together into chords', () => {
  const groups = groupNotes([note(0, 60), note(0.01, 64), note(0.5, 67)]);

  assert.deepEqual(groups.map((group) => group.length), [2, 1]);
});

test('every note is placed where it really sounds', () => {
  const melody = [64, 67, 69, 71, 72, 74, 76, 79, 81, 84, 76, 72, 69, 64].map((pitch, index) => note(index * 0.3, pitch));
  const placed = assignFrets(melody);

  assert.equal(placed.length, melody.length);

  for (const place of placed) {
    assert.equal(GUITAR_STRINGS.tuning[place.string] + place.fret, place.pitch);
    assert.ok(place.fret >= 0 && place.fret <= 20);
  }
});

test('a melody stays in one area of the neck', () => {
  const melody = [69, 72, 74, 76, 79, 81, 79, 76, 74, 72, 69].map((pitch, index) => note(index * 0.3, pitch));
  const frets = assignFrets(melody).filter((place) => place.fret > 0).map((place) => place.fret);

  assert.ok(Math.max(...frets) - Math.min(...frets) <= 5, `frets ${frets}`);
});

test('chord notes go on different strings', () => {
  const chord = [note(0, 48), note(0, 52), note(0, 55), note(0, 60)];
  const placed = assignFrets(chord);

  assert.equal(new Set(placed.map((place) => place.string)).size, 4);
});

test('notes out of reach are left out instead of breaking the tab', () => {
  const placed = assignFrets([note(0, 20), note(0.5, 64), note(1, 110), note(1.5, 67)]);

  assert.deepEqual(placed.map((place) => place.pitch), [64, 67]);

  const wide = assignFrets([note(0, 40), note(0, 41), note(0, 42), note(0, 43), note(0, 88)]);
  assert.ok(wide.length >= 1);
});

test('bass lines use bass tuning', () => {
  const placed = assignFrets([note(0, 28), note(0.5, 33), note(1, 40)], BASS_STRINGS);

  assert.deepEqual(placed.map((place) => BASS_STRINGS.tuning[place.string] + place.fret), [28, 33, 40]);
});

test('bars follow the downbeats', () => {
  assert.deepEqual(barEdges(2, 8, [0, 2.4, 4.8, 7.2, 9.6]), [0, 2.4, 4.8, 7.2, 8]);
  assert.deepEqual(barEdges(0, 5, []), [0, 2.4, 4.8, 5]);
});

test('tab has six labelled strings and puts frets in the right columns', () => {
  const tab = buildTab([note(0, 64), note(0.6, 67)], { start: 0, end: 2.4, downbeats: [0, 2.4], beatsPerBar: 4 });
  const lines = tab.split('\n');

  assert.equal(lines.length, 7);
  assert.match(lines[0], /0:00/);
  assert.deepEqual(lines.slice(1).map((line) => line.slice(0, 2).trim()), ['e', 'B', 'G', 'D', 'A', 'E']);

  const high = lines[1];
  assert.equal(high.length, 2 + 1 + 16 * 3 + 1);
  assert.ok(high.includes('0--') || lines[2].includes('5--'));
});

test('note names are listed bar by bar', () => {
  const text = buildNoteNames([note(0, 60), note(0.5, 64), note(2.5, 67), note(2.5, 71)], { start: 0, end: 4.8, downbeats: [0, 2.4, 4.8] });

  assert.equal(text, ' 0:00  C4 E4\n 0:02  (G4 B4)');
});
