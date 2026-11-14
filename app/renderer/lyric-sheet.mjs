import { NO_CHORD, displayChord, findIndexAt } from './chart.mjs';

// a gap between sung lines at least this long gets its own row of chords, in seconds
export const INSTRUMENTAL_GAP = 2.5;

// words the transcription is less sure of than this are shown greyed out
export const LOW_WORD_CONFIDENCE = 0.4;

// how long after a line ends it still counts as the current line, in seconds
const LINE_HOLD = 0.6;

export const LANGUAGES = [
  ['auto', 'Detect automatically'],
  ['en', 'English'],
  ['hi', 'Hindi'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['es', 'Spanish'],
  ['tl', 'Filipino (Tagalog)'],
  ['ur', 'Urdu'],
  ['pa', 'Punjabi'],
  ['bn', 'Bengali'],
  ['mr', 'Marathi'],
  ['ta', 'Tamil'],
  ['te', 'Telugu'],
  ['zh', 'Chinese'],
  ['fr', 'French'],
  ['pt', 'Portuguese'],
  ['de', 'German'],
  ['it', 'Italian'],
  ['id', 'Indonesian'],
  ['ar', 'Arabic'],
  ['ru', 'Russian'],
  ['th', 'Thai'],
  ['vi', 'Vietnamese'],
  ['tr', 'Turkish'],
];

function chordsBetween(chords, start, end) {
  return chords
    .map((chord, index) => ({ chord, index }))
    .filter(({ chord }) => chord.start >= start && chord.start < end && chord.label !== NO_CHORD);
}

function compact(entries) {
  return entries.filter((entry, position) => position === 0 || entries[position - 1].chord.label !== entry.chord.label);
}

function labelEntries(entries) {
  return entries.map(({ chord, index }) => ({ label: displayChord(chord.label), index }));
}

export function buildLyricSheet(lyrics, analysis) {
  const chords = analysis?.chords ?? [];
  const sections = analysis?.sections ?? [];
  const end = chords.at(-1)?.end ?? lyrics.lines.at(-1)?.end ?? 0;
  const items = [];

  let shownChord = -1;
  let sectionIndex = -1;
  let cursor = 0;

  const addHeadingFor = (seconds) => {
    const index = findIndexAt(sections, seconds);

    if (index >= 0 && index !== sectionIndex) {
      sectionIndex = index;
      items.push({ type: 'heading', label: sections[index].label, start: sections[index].start });
    }
  };

  const addInstrumental = (from, to) => {
    const entries = compact(chordsBetween(chords, from, to));

    if (entries.length === 0) {
      return;
    }

    addHeadingFor(entries[0].chord.start);
    items.push({ type: 'instrumental', start: from, end: to, chords: labelEntries(entries) });
    shownChord = entries.at(-1).index;
  };

  const unheard = [...(lyrics.unheard ?? [])];

  const addUnheardBefore = (seconds) => {
    while (unheard.length > 0 && unheard[0][0] < seconds) {
      const [from, to] = unheard.shift();
      addHeadingFor(from);
      items.push({ type: 'unheard', start: from, end: to });
    }
  };

  lyrics.lines.forEach((line, lineIndex) => {
    addUnheardBefore(line.start);

    if (line.start - cursor >= INSTRUMENTAL_GAP || (lineIndex === 0 && line.start > 0)) {
      addInstrumental(cursor, line.start);
    }

    addHeadingFor(line.start);

    const tokens = line.words.map((word, wordIndex) => {
      const nextStart = line.words[wordIndex + 1]?.start ?? line.end;
      const playing = findIndexAt(chords, word.start);
      const entries = [];

      if (playing >= 0 && playing !== shownChord && chords[playing].label !== NO_CHORD) {
        entries.push({ chord: chords[playing], index: playing });
      }

      const during = chordsBetween(chords, word.start, nextStart).filter(({ index }) => index !== playing);
      entries.push(...during);

      if (entries.length > 0) {
        shownChord = entries.at(-1).index;
      } else if (playing >= 0) {
        shownChord = playing;
      }

      return {
        wordIndex,
        text: word.text.trim(),
        spaced: wordIndex > 0 && /^\s/.test(word.text),
        start: word.start,
        end: word.end,
        doubtful: Boolean(word.estimated) || word.confidence < LOW_WORD_CONFIDENCE,
        chords: labelEntries(compact(entries)),
      };
    });

    items.push({ type: 'line', lineIndex, start: line.start, end: line.end, romanized: line.romanized ?? null, tokens });
    cursor = line.end;
  });

  addUnheardBefore(Infinity);

  if (end - cursor > 0) {
    addInstrumental(cursor, end + 1);
  }

  return items;
}

export function findWordAt(lyrics, seconds) {
  const lines = lyrics?.lines ?? [];
  let low = 0;
  let high = lines.length - 1;
  let found = -1;

  while (low <= high) {
    const middle = (low + high) >> 1;

    if (lines[middle].start <= seconds) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  if (found < 0 || seconds > lines[found].end + LINE_HOLD) {
    return null;
  }

  const words = lines[found].words;
  let wordIndex = 0;

  for (let index = 0; index < words.length; index++) {
    if (words[index].start <= seconds) {
      wordIndex = index;
    }
  }

  return { lineIndex: found, wordIndex };
}

export function describeLanguage(lyrics) {
  if (!lyrics.language) {
    return '';
  }

  const [top, second] = lyrics.detected ?? [];

  if (!top) {
    return `Language: ${lyrics.languageName}`;
  }

  const close = second && second.probability >= 0.1 && second.code !== lyrics.language;
  const heardAs = top.code !== lyrics.language ? ` (it sounded closest to ${top.name})` : '';
  const alternative = close ? `, could also be ${second.name}` : '';

  return `Language: ${lyrics.languageName}, detected${heardAs}${alternative}`;
}

export function lyricsAsText(lyrics) {
  return lyrics.lines.map((line) => line.text).join('\n');
}
