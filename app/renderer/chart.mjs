export const NO_CHORD = 'N';
export const LOW_CONFIDENCE = 0.4;

const MINIMUM_SHARE_OF_BAR = 0.2;

export function displayChord(label) {
  return label === NO_CHORD ? '-' : label;
}

export function isChordDoubtful(analysis, chord) {
  if (chord.edited) {
    return false;
  }

  return !analysis.chordsReliable || chord.confidence < LOW_CONFIDENCE;
}

export function findIndexAt(items, seconds) {
  let low = 0;
  let high = items.length - 1;

  while (low <= high) {
    const middle = (low + high) >> 1;

    if (seconds < items[middle].start) {
      high = middle - 1;
    } else if (seconds >= items[middle].end) {
      low = middle + 1;
    } else {
      return middle;
    }
  }

  return -1;
}

export function currentAndNextChord(chords, seconds) {
  const index = findIndexAt(chords, seconds);

  if (index < 0) {
    return { current: null, next: null };
  }

  return { current: chords[index], next: chords[index + 1] ?? null };
}

function barEdgesFor(analysis) {
  const end = analysis.chords.at(-1)?.end ?? 0;
  const downbeats = (analysis.downbeats ?? []).filter((time) => time > 0 && time < end);

  if (downbeats.length < 2) {
    return analysis.chords.flatMap((chord, index) => (index === 0 ? [chord.start, chord.end] : [chord.end]));
  }

  return [0, ...downbeats, end];
}

function chordsInBar(analysis, start, end) {
  const length = end - start;
  const overlaps = [];

  analysis.chords.forEach((chord, chordIndex) => {
    const overlap = Math.min(end, chord.end) - Math.max(start, chord.start);

    if (overlap > 0) {
      overlaps.push({ chord, chordIndex, overlap });
    }
  });

  const kept = overlaps.filter(({ overlap }) => overlap / length >= MINIMUM_SHARE_OF_BAR);
  const shown = kept.length > 0 ? kept : overlaps.slice(0, 1);

  return shown.map(({ chord, chordIndex }) => ({
    chordIndex,
    label: displayChord(chord.label),
    doubtful: isChordDoubtful(analysis, chord),
  }));
}

export function buildChart(analysis) {
  const edges = barEdgesFor(analysis);
  const bars = [];

  for (let index = 0; index < edges.length - 1; index++) {
    if (edges[index + 1] > edges[index]) {
      bars.push({ start: edges[index], end: edges[index + 1] });
    }
  }

  return analysis.sections.map((section, sectionIndex) => ({
    sectionIndex,
    label: section.label,
    start: section.start,
    end: section.end,
    bars: bars
      .filter((bar) => {
        const middle = (bar.start + bar.end) / 2;
        return middle >= section.start && middle < section.end;
      })
      .map((bar) => ({ ...bar, chords: chordsInBar(analysis, bar.start, bar.end) })),
  }));
}

export function renameChord(analysis, index, label) {
  const chords = analysis.chords.map((chord, chordIndex) =>
    chordIndex === index ? { ...chord, label, edited: true } : chord,
  );

  return { ...analysis, chords: mergeMatchingChords(chords) };
}

function mergeMatchingChords(chords) {
  const merged = [];

  for (const chord of chords) {
    const previous = merged.at(-1);

    if (previous && previous.label === chord.label) {
      merged[merged.length - 1] = {
        ...previous,
        end: chord.end,
        edited: previous.edited || chord.edited,
      };
    } else {
      merged.push(chord);
    }
  }

  return merged;
}

function splitItems(items, index, seconds, secondHalf) {
  const item = items[index];

  if (!item || seconds <= item.start || seconds >= item.end) {
    return items;
  }

  return [
    ...items.slice(0, index),
    { ...item, end: seconds },
    { ...item, ...secondHalf, start: seconds },
    ...items.slice(index + 1),
  ];
}

function mergeWithPrevious(items, index) {
  if (index <= 0 || index >= items.length) {
    return items;
  }

  return [
    ...items.slice(0, index - 1),
    { ...items[index - 1], end: items[index].end },
    ...items.slice(index + 1),
  ];
}

export function splitChord(analysis, index, seconds) {
  return { ...analysis, chords: splitItems(analysis.chords, index, seconds, { edited: true }) };
}

export function mergeChordWithPrevious(analysis, index) {
  return { ...analysis, chords: mergeMatchingChords(mergeWithPrevious(analysis.chords, index)) };
}

export function renameSection(analysis, index, label) {
  const sections = analysis.sections.map((section, sectionIndex) =>
    sectionIndex === index ? { ...section, label } : section,
  );

  return { ...analysis, sections };
}

export function splitSection(analysis, index, seconds) {
  return { ...analysis, sections: splitItems(analysis.sections, index, seconds, {}) };
}

export function mergeSectionWithPrevious(analysis, index) {
  return { ...analysis, sections: mergeWithPrevious(analysis.sections, index) };
}

export function setKeyName(analysis, name) {
  return { ...analysis, key: { ...analysis.key, name, confidence: 1, edited: true } };
}

export function setTempo(analysis, bpm) {
  return { ...analysis, tempo: { ...analysis.tempo, bpm, confidence: 1, edited: true } };
}
