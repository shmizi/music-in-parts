import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLyricSheet, describeLanguage, findWordAt, lyricsAsText } from '../app/renderer/lyric-sheet.mjs';

function word(text, start, end, confidence = 0.9) {
  return { text, start, end, confidence };
}

const lyrics = {
  language: 'en',
  languageName: 'English',
  detected: [{ code: 'en', name: 'English', probability: 0.99 }],
  lines: [
    { start: 4, end: 7, text: 'hello there friend', words: [word('hello', 4, 5), word(' there', 5, 6), word(' friend', 6, 7, 0.2)] },
    { start: 7.5, end: 9.5, text: 'sing along', words: [word('sing', 7.5, 8.5), word(' along', 8.5, 9.5)] },
    { start: 16, end: 18, text: 'again', words: [word('again', 16, 18)] },
  ],
};

const analysis = {
  chords: [
    { start: 0, end: 2, label: 'N' },
    { start: 2, end: 5, label: 'Am' },
    { start: 5, end: 8, label: 'F' },
    { start: 8, end: 9, label: 'C' },
    { start: 9, end: 12, label: 'G' },
    { start: 12, end: 16, label: 'Am' },
    { start: 16, end: 20, label: 'F' },
  ],
  sections: [
    { start: 0, end: 7.2, label: 'Verse' },
    { start: 7.2, end: 20, label: 'Chorus' },
  ],
};

test('chords sit above the word where they start', () => {
  const items = buildLyricSheet(lyrics, analysis);
  const first = items.find((item) => item.type === 'line');

  assert.deepEqual(first.tokens.map((token) => token.chords.map((chord) => chord.label)), [[], ['F'], []]);
});

test('an intro before the first line shows its chords', () => {
  const items = buildLyricSheet(lyrics, analysis);

  assert.equal(items[0].type, 'heading');
  assert.equal(items[1].type, 'instrumental');
  assert.deepEqual(items[1].chords.map((chord) => chord.label), ['Am']);
});

test('a chord that changes during a held word is not lost', () => {
  const items = buildLyricSheet(lyrics, analysis);
  const second = items.filter((item) => item.type === 'line')[1];

  assert.deepEqual(second.tokens.map((token) => token.chords.map((chord) => chord.label)), [['C'], ['G']]);
});

test('a long gap between lines gets its own row of chords', () => {
  const items = buildLyricSheet(lyrics, analysis);
  const gap = items.find((item) => item.type === 'instrumental' && item.start === 9.5);

  assert.deepEqual(gap.chords.map((chord) => chord.label), ['Am']);
});

test('sections become headings in time order', () => {
  const headings = buildLyricSheet(lyrics, analysis).filter((item) => item.type === 'heading');

  assert.deepEqual(headings.map((heading) => heading.label), ['Verse', 'Chorus']);
});

test('spacing and doubt are kept for each word', () => {
  const first = buildLyricSheet(lyrics, analysis).find((item) => item.type === 'line');

  assert.deepEqual(first.tokens.map((token) => token.spaced), [false, true, true]);
  assert.deepEqual(first.tokens.map((token) => token.doubtful), [false, false, true]);
  assert.equal(first.tokens[1].text, 'there');
});

test('lyrics work without any chords', () => {
  const items = buildLyricSheet(lyrics, null);

  assert.equal(items.filter((item) => item.type === 'line').length, 3);
  assert.ok(items.every((item) => item.type === 'line'));
});

test('finds the word being sung', () => {
  assert.deepEqual(findWordAt(lyrics, 5.5), { lineIndex: 0, wordIndex: 1 });
  assert.deepEqual(findWordAt(lyrics, 7.3), { lineIndex: 0, wordIndex: 2 });
  assert.equal(findWordAt(lyrics, 2), null);
  assert.equal(findWordAt(lyrics, 12), null);
});

test('describes the detected language', () => {
  assert.equal(describeLanguage(lyrics), 'Language: English, detected');

  const hindi = {
    language: 'hi',
    languageName: 'Hindi',
    detected: [{ code: 'ur', name: 'Urdu', probability: 0.6 }, { code: 'hi', name: 'Hindi', probability: 0.3 }],
  };

  assert.equal(describeLanguage(hindi), 'Language: Hindi, detected (it sounded closest to Urdu)');
});

test('turns lyrics back into plain text for editing', () => {
  assert.equal(lyricsAsText(lyrics), 'hello there friend\nsing along\nagain');
});
