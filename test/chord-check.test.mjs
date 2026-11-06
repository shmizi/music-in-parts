import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkChords,
  describeNotes,
  fingerprint,
  parseChord,
  readThird,
  sameRootIndexes,
  similarCopies,
  similarity,
} from '../app/renderer/chord-check.mjs';
import { isChordDoubtful, markChordsChecked, renameChords } from '../app/renderer/chart.mjs';

const NOTES = { C: 0, 'C#': 1, D: 2, Eb: 3, E: 4, F: 5, 'F#': 6, G: 7, A: 9, Bb: 10, B: 11 };

function levels(notes) {
  const row = new Array(12).fill(5);

  for (const [name, level] of Object.entries(notes)) {
    row[NOTES[name]] = level;
  }

  return row;
}

const SOUNDS = {
  Gm: levels({ G: 200, Bb: 150, D: 180 }),
  Bb: levels({ Bb: 200, D: 150, F: 180 }),
  Dmajor: levels({ D: 200, 'F#': 150, A: 180 }),
  Dminor: levels({ D: 200, F: 150, A: 180 }),
  Dseven: levels({ D: 200, 'F#': 150, A: 180, C: 150 }),
  Dbare: levels({ D: 200, A: 180 }),
  Dcrowded: levels({ D: 100, 'F#': 100, A: 100, G: 220, Bb: 220, C: 220 }),
};

function buildSong(rows) {
  const chords = [];
  const grid = [0];
  const evidenceLevels = [];

  rows.forEach(([label, sound], index) => {
    chords.push({ start: index * 2, end: (index + 1) * 2, label, confidence: 0.8 });
    grid.push((index + 1) * 2);
    evidenceLevels.push(SOUNDS[sound]);
  });

  return {
    analysis: { chords, sections: [], chordsReliable: true, key: { useFlats: true } },
    evidence: { grid, levels: evidenceLevels },
  };
}

function loop(thirdChordLabel, thirdChordSound) {
  return [['Gm', 'Gm'], ['Bb', 'Bb'], [thirdChordLabel, thirdChordSound]];
}

test('reads chord names', () => {
  assert.deepEqual(parseChord('Bbm7'), { rootName: 'Bb', root: 10, suffix: 'm7' });
  assert.equal(parseChord('N'), null);
  assert.equal(parseChord('hello'), null);
  assert.equal(parseChord(undefined), null);
});

test('a chord fingerprint averages over its length', () => {
  const evidence = {
    grid: [0, 1, 3],
    levels: [new Array(12).fill(10), new Array(12).fill(40)],
  };

  assert.equal(fingerprint(evidence, 0, 3)[0], 30);
  assert.equal(fingerprint(evidence, 0, 1)[5], 10);
  assert.equal(fingerprint(evidence, 50, 60)[0], 0);
});

test('similarity ignores loudness', () => {
  const quiet = SOUNDS.Gm.map((value) => value / 4);

  assert.ok(Math.abs(similarity(SOUNDS.Gm, quiet) - 1) < 1e-9);
  assert.ok(similarity(SOUNDS.Gm, SOUNDS.Dmajor) < 0.9);
  assert.equal(similarity(new Array(12).fill(0), SOUNDS.Gm), 0);
});

test('the third decides major, minor or neither', () => {
  assert.equal(readThird(SOUNDS.Dmajor, 2).third, 'major');
  assert.equal(readThird(SOUNDS.Dminor, 2).third, 'minor');
  assert.equal(readThird(SOUNDS.Dbare, 2).third, 'none');
  assert.equal(readThird(levels({ D: 200, A: 180, F: 150, 'F#': 150 }), 2).third, 'both');
  assert.deepEqual(readThird(SOUNDS.Dseven, 2).sevenths, ['flat']);
  assert.equal(readThird(new Array(12).fill(0), 2).third, 'none');
});

test('describes the notes heard in a chord', () => {
  const notes = describeNotes(SOUNDS.Dbare, 2, false);
  const strengthOf = (role) => notes.find((note) => note.role === role).strength;

  assert.equal(notes.find((note) => note.role === 'major 3rd').name, 'F#');
  assert.equal(strengthOf('root'), 'clear');
  assert.equal(strengthOf('5th'), 'clear');
  assert.equal(strengthOf('major 3rd'), 'missing');
});

test('flags different names that sound alike in the same spot', () => {
  const { analysis, evidence } = buildSong([
    ...loop('D', 'Dbare'),
    ...loop('Dm', 'Dbare'),
    ...loop('D7', 'Dbare'),
    ...loop('D', 'Dbare'),
  ]);

  const findings = checkChords(analysis, evidence).filter((f) => f.kind === 'different-names');

  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].indexes, [2, 5, 8, 11]);
  assert.equal(findings[0].suggestion, 'D5');
  assert.match(findings[0].message, /D, Dm and D7 sound alike/);
  assert.match(findings[0].message, /No clear 3rd/);
});

test('the suggested name follows the third that is actually heard', () => {
  const { analysis, evidence } = buildSong([
    ...loop('Dm', 'Dmajor'),
    ...loop('D', 'Dmajor'),
    ...loop('Dm', 'Dmajor'),
  ]);

  assert.equal(checkChords(analysis, evidence)[0].suggestion, 'D');
});

test('does not flag names the sound backs up', () => {
  const { analysis, evidence } = buildSong([
    ...loop('D', 'Dmajor'),
    ...loop('Dm', 'Dminor'),
    ...loop('D7', 'Dseven'),
    ...loop('D', 'Dmajor'),
  ]);

  assert.deepEqual(checkChords(analysis, evidence), []);
});

test('flags copies of a chord missing the third the others have', () => {
  const { analysis, evidence } = buildSong([
    ...loop('D', 'Dmajor'),
    ...loop('D', 'Dmajor'),
    ...loop('D', 'Dbare'),
    ...loop('D', 'Dbare'),
  ]);

  const findings = checkChords(analysis, evidence).filter((f) => f.kind === 'no-third');

  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].indexes, [8, 11]);
  assert.equal(findings[0].suggestion, 'D5');
});

test('flags a copy that sounds unlike the others of its name', () => {
  const { analysis, evidence } = buildSong([
    ...loop('D', 'Dmajor'),
    ...loop('D', 'Dmajor'),
    ...loop('D', 'Dmajor'),
    ...loop('D', 'Dmajor'),
    ...loop('D', 'Gm'),
  ]);

  const findings = checkChords(analysis, evidence).filter((f) => f.kind === 'odd-one-out');

  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].indexes, [14]);
  assert.equal(findings[0].atSeconds, 28);
});

test('several odd copies of a chord become one finding', () => {
  const { analysis, evidence } = buildSong([
    ...loop('D', 'Dmajor'),
    ...loop('D', 'Dmajor'),
    ...loop('D', 'Dmajor'),
    ...loop('D', 'Dmajor'),
    ...loop('D', 'Dmajor'),
    ...loop('D', 'Dcrowded'),
    ...loop('D', 'Dcrowded'),
  ]);

  const findings = checkChords(analysis, evidence).filter((f) => f.kind === 'odd-one-out');

  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].indexes, [17, 20]);
  assert.match(findings[0].message, /2 of the 7 D chords/);
});

test('changing all to the suggestion clears the finding', () => {
  const { analysis, evidence } = buildSong([
    ...loop('D', 'Dbare'),
    ...loop('Dm', 'Dbare'),
    ...loop('D7', 'Dbare'),
  ]);

  const [finding] = checkChords(analysis, evidence);
  const changed = renameChords(analysis, finding.indexes, finding.suggestion);

  assert.deepEqual(checkChords(changed, evidence), []);
  assert.deepEqual(changed.chords.map((chord) => chord.label).filter((label) => label.startsWith('D')), ['D5', 'D5', 'D5']);
});

test('keeping chords as they are clears the finding and the doubt flag', () => {
  const { analysis, evidence } = buildSong([
    ...loop('D', 'Dbare'),
    ...loop('Dm', 'Dbare'),
    ...loop('D7', 'Dbare'),
  ]);

  const [finding] = checkChords(analysis, evidence);
  const kept = markChordsChecked(analysis, finding.indexes);

  assert.deepEqual(checkChords(kept, evidence), []);
  assert.equal(isChordDoubtful({ ...kept, chordsReliable: false }, kept.chords[finding.indexes[0]]), false);
});

test('your own correction becomes the suggestion for the rest', () => {
  const { analysis, evidence } = buildSong([
    ...loop('D', 'Dbare'),
    ...loop('Dm', 'Dbare'),
    ...loop('D', 'Dbare'),
  ]);

  const corrected = renameChords(analysis, [5], 'Dsus2');

  assert.equal(checkChords(corrected, evidence)[0].suggestion, 'Dsus2');
});

test('finds which chords to step through and change together', () => {
  const { analysis, evidence } = buildSong([
    ...loop('D', 'Dbare'),
    ...loop('Dm', 'Dbare'),
    ...loop('D', 'Dminor'),
  ]);

  assert.deepEqual(sameRootIndexes(analysis, 2), [2, 5, 8]);
  assert.deepEqual(similarCopies(analysis, evidence, 2).slice(0, 2), [2, 5]);
  assert.deepEqual(similarCopies(analysis, null, 2), [2, 8]);
});

test('without evidence there is nothing to report', () => {
  const { analysis } = buildSong(loop('D', 'Dbare'));

  assert.deepEqual(checkChords(analysis, null), []);
});
