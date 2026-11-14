import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeCrossChecks } from '../app/renderer/chart.mjs';
import { parseChord } from '../app/renderer/chord-check.mjs';
import { buildLyricSheet } from '../app/renderer/lyric-sheet.mjs';

function word(text, start, end) {
  return { text, start, end, confidence: 0.9 };
}

test('songs analysed before cross-checks existed show no note', () => {
  assert.equal(describeCrossChecks({ chords: [] }), null);
  assert.equal(describeCrossChecks(null), null);
});

test('describes where the section names came from', () => {
  const fromLyrics = describeCrossChecks({ crossChecks: { sections: 'lyrics', chordChanges: [] } });
  const fromSound = describeCrossChecks({ crossChecks: { sections: 'sound', chordChanges: [] } });

  assert.match(fromLyrics.summary, /named from the lyrics/);
  assert.match(fromLyrics.summary, /agreed with the chords/);
  assert.match(fromSound.summary, /sound alone/);
  assert.deepEqual(fromLyrics.changes, []);
});

test('lists each chord a cross-check changed', () => {
  const checks = describeCrossChecks({
    crossChecks: {
      sections: 'lyrics',
      chordChanges: [
        { start: 48.1, end: 50.7, from: 'B', to: 'B/F#', reason: 'bass' },
        { start: 75, end: 77, from: 'D', to: 'Dm', reason: 'notes' },
        { start: 130, end: 132, from: 'A', to: 'Am', reason: 'repeats' },
      ],
    },
  });

  assert.match(checks.summary, /3 chords were changed/);
  assert.deepEqual(checks.changes.map((change) => change.text), [
    '0:48  B became B/F#, from the bass note',
    '1:15  D became Dm, from the notes played',
    '2:10  A became Am, from the other copies of this section',
  ]);
});

test('one change is described in the singular', () => {
  const checks = describeCrossChecks({
    crossChecks: { sections: 'sound', chordChanges: [{ start: 1, end: 2, from: 'D', to: 'Dm', reason: 'notes' }] },
  });

  assert.match(checks.summary, /1 chord was changed/);
});

test('Chord Check reads a slash chord as the chord above its bass note', () => {
  assert.deepEqual(parseChord('D/F#'), { rootName: 'D', root: 2, suffix: '' });
  assert.deepEqual(parseChord('Bbm7/F'), { rootName: 'Bb', root: 10, suffix: 'm7' });
});

test('singing that could not be written out gets its own row in time order', () => {
  const lyrics = {
    lines: [
      { start: 4, end: 6, text: 'first line', words: [word('first', 4, 5), word(' line', 5, 6)] },
      { start: 20, end: 22, text: 'last line', words: [word('last', 20, 21), word(' line', 21, 22)] },
    ],
    unheard: [[8, 14], [24, 30]],
  };

  const items = buildLyricSheet(lyrics, null);

  assert.deepEqual(
    items.map((item) => [item.type, item.start]),
    [['line', 4], ['unheard', 8], ['line', 20], ['unheard', 24]],
  );
});

test('lyrics saved before unheard singing was tracked still work', () => {
  const lyrics = { lines: [{ start: 4, end: 6, text: 'first', words: [word('first', 4, 6)] }] };

  assert.deepEqual(buildLyricSheet(lyrics, null).map((item) => item.type), ['line']);
});
