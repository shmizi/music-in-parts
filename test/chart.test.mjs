import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildChart,
  currentAndNextChord,
  findIndexAt,
  isChordDoubtful,
  mergeChordWithPrevious,
  mergeSectionWithPrevious,
  renameChord,
  renameSection,
  splitChord,
  splitSection,
} from '../app/renderer/chart.mjs';

function sampleAnalysis() {
  return {
    chordsReliable: true,
    downbeats: [2, 4, 6, 8],
    chords: [
      { start: 0, end: 2, label: 'Am', confidence: 0.9 },
      { start: 2, end: 5, label: 'F', confidence: 0.3 },
      { start: 5, end: 8, label: 'C', confidence: 0.8 },
      { start: 8, end: 10, label: 'N', confidence: 0.8 },
    ],
    sections: [
      { start: 0, end: 4, label: 'Intro' },
      { start: 4, end: 10, label: 'Verse' },
    ],
  };
}

test('finds what is playing at a given time', () => {
  const { chords } = sampleAnalysis();

  assert.equal(findIndexAt(chords, 0), 0);
  assert.equal(findIndexAt(chords, 2), 1);
  assert.equal(findIndexAt(chords, 9.9), 3);
  assert.equal(findIndexAt(chords, 10), -1);

  const { current, next } = currentAndNextChord(chords, 3);
  assert.equal(current.label, 'F');
  assert.equal(next.label, 'C');
  assert.equal(currentAndNextChord(chords, 9).next, null);
});

test('the chart groups bars under their sections', () => {
  const chart = buildChart(sampleAnalysis());

  assert.deepEqual(chart.map((section) => section.label), ['Intro', 'Verse']);
  assert.deepEqual(chart[0].bars.map((bar) => bar.start), [0, 2]);
  assert.deepEqual(chart[1].bars.map((bar) => bar.start), [4, 6, 8]);
});

test('a bar lists each chord it contains, and hides passing blips', () => {
  const chart = buildChart(sampleAnalysis());
  const bar = chart[1].bars[0];

  assert.deepEqual(bar.chords.map((chord) => chord.label), ['F', 'C']);

  const analysis = sampleAnalysis();
  analysis.chords = [
    { start: 0, end: 3.9, label: 'Am', confidence: 0.9 },
    { start: 3.9, end: 4, label: 'G', confidence: 0.9 },
    { start: 4, end: 10, label: 'F', confidence: 0.9 },
  ];

  const blipBar = buildChart(analysis)[0].bars[1];
  assert.deepEqual(blipBar.chords.map((chord) => chord.label), ['Am']);
});

test('no-chord stretches show as a dash', () => {
  const chart = buildChart(sampleAnalysis());

  assert.equal(chart[1].bars[2].chords[0].label, '-');
});

test('without downbeats each chord gets its own cell', () => {
  const analysis = sampleAnalysis();
  analysis.downbeats = [];

  const bars = buildChart(analysis).flatMap((section) => section.bars);

  assert.deepEqual(bars.map((bar) => bar.chords[0].label), ['Am', 'F', 'C', '-']);
});

test('chords are flagged when unsure, and an edit clears the flag', () => {
  const analysis = sampleAnalysis();

  assert.equal(isChordDoubtful(analysis, analysis.chords[0]), false);
  assert.equal(isChordDoubtful(analysis, analysis.chords[1]), true);
  assert.equal(isChordDoubtful({ ...analysis, chordsReliable: false }, analysis.chords[0]), true);

  const edited = renameChord(analysis, 1, 'Fmaj7');
  assert.equal(edited.chords[1].label, 'Fmaj7');
  assert.equal(isChordDoubtful(edited, edited.chords[1]), false);
});

test('renaming a chord to match its neighbour joins them', () => {
  const edited = renameChord(sampleAnalysis(), 1, 'Am');

  assert.equal(edited.chords.length, 3);
  assert.equal(edited.chords[0].label, 'Am');
  assert.equal(edited.chords[0].end, 5);
});

test('edits leave the original analysis unchanged', () => {
  const analysis = sampleAnalysis();

  renameChord(analysis, 0, 'A');
  renameSection(analysis, 0, 'Start');

  assert.equal(analysis.chords[0].label, 'Am');
  assert.equal(analysis.sections[0].label, 'Intro');
});

test('chords and sections can be split and merged', () => {
  const analysis = sampleAnalysis();

  const split = splitChord(analysis, 1, 3);
  assert.deepEqual(split.chords.slice(1, 3).map((c) => [c.start, c.end]), [[2, 3], [3, 5]]);

  assert.equal(splitChord(analysis, 1, 7).chords.length, analysis.chords.length);

  const merged = mergeChordWithPrevious(analysis, 2);
  assert.deepEqual(merged.chords.map((c) => c.label), ['Am', 'F', 'N']);
  assert.equal(merged.chords[1].end, 8);

  assert.equal(mergeChordWithPrevious(analysis, 0).chords.length, analysis.chords.length);

  const sections = splitSection(analysis, 1, 6);
  assert.deepEqual(sections.sections.map((s) => s.start), [0, 4, 6]);

  const joined = mergeSectionWithPrevious(analysis, 1);
  assert.deepEqual(joined.sections, [{ start: 0, end: 10, label: 'Intro' }]);
});
