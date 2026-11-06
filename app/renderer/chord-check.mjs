const PITCH_CLASSES = {
  C: 0, 'B#': 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4, F: 5, 'E#': 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11,
};

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// semitone steps above the root
const MINOR_THIRD = 3;
const MAJOR_THIRD = 4;
const FIFTH = 7;
const FLAT_SEVENTH = 10;
const MAJOR_SEVENTH = 11;

// chords this similar sound like the same chord, from 0 (unrelated) to 1 (identical)
export const SAME_SOUND = 0.93;

// the same chords either side make a match more likely, so less similarity is needed
export const SAME_SOUND_IN_CONTEXT = 0.85;

// chords on different roots must be this similar, in the same spot, to count as a likely mix-up
export const SAME_SPOT_DIFFERENT_ROOT = 0.92;

// a copy less similar than this to the others of its name sounds like the odd one out
export const ODD_ONE_OUT = 0.75;

// a third weaker than this, as a fraction of the root or fifth, counts as not really there
export const THIRD_PRESENT = 0.2;

// a third this strong is definitely there, so a copy without one is a different sound
export const THIRD_CLEAR = 0.4;

// sevenths need to be stronger to count, since neighbouring notes leak into them
export const SEVENTH_PRESENT = 0.45;

// one third must beat the other by this factor to decide between major and minor
export const THIRD_MARGIN = 1.5;

// chords shorter than this, in seconds, are too brief to compare fairly
const SHORTEST_CHORD = 0.4;

const MINIMUM_COPIES_FOR_ODD_ONE_OUT = 4;
const MINIMUM_COPIES_WITHOUT_THIRD = 2;

export function parseChord(label) {
  const match = /^([A-G][#b]?)(.*)$/.exec(label ?? '');

  if (!match || !(match[1] in PITCH_CLASSES)) {
    return null;
  }

  return { rootName: match[1], root: PITCH_CLASSES[match[1]], suffix: match[2] };
}

function noteName(pitchClass, useFlats) {
  return (useFlats ? FLAT_NAMES : SHARP_NAMES)[pitchClass % 12];
}

export function fingerprint(evidence, start, end) {
  const totals = new Array(12).fill(0);
  let weight = 0;

  for (let step = 0; step < evidence.levels.length; step++) {
    const overlap = Math.min(end, evidence.grid[step + 1]) - Math.max(start, evidence.grid[step]);

    if (overlap > 0) {
      weight += overlap;

      for (let note = 0; note < 12; note++) {
        totals[note] += evidence.levels[step][note] * overlap;
      }
    }
  }

  return weight > 0 ? totals.map((value) => value / weight) : totals;
}

export function similarity(first, second) {
  let product = 0;
  let firstSize = 0;
  let secondSize = 0;

  for (let note = 0; note < 12; note++) {
    product += first[note] * second[note];
    firstSize += first[note] * first[note];
    secondSize += second[note] * second[note];
  }

  return firstSize > 0 && secondSize > 0 ? product / Math.sqrt(firstSize * secondSize) : 0;
}

export function readThird(print, root) {
  // reference: how strong the chord's frame is, from its root and fifth
  const reference = Math.max(print[root], print[(root + FIFTH) % 12]);

  if (reference <= 0) {
    return { third: 'none', sevenths: [], major: 0, minor: 0, flatSeventh: 0, majorSeventh: 0 };
  }

  const major = print[(root + MAJOR_THIRD) % 12] / reference;
  const minor = print[(root + MINOR_THIRD) % 12] / reference;

  let third = 'none';

  if (major >= THIRD_PRESENT && major >= minor * THIRD_MARGIN) {
    third = 'major';
  } else if (minor >= THIRD_PRESENT && minor >= major * THIRD_MARGIN) {
    third = 'minor';
  } else if (major >= THIRD_PRESENT || minor >= THIRD_PRESENT) {
    third = 'both';
  }

  const flatSeventh = print[(root + FLAT_SEVENTH) % 12] / reference;
  const majorSeventh = print[(root + MAJOR_SEVENTH) % 12] / reference;
  const sevenths = [];

  if (flatSeventh >= SEVENTH_PRESENT) {
    sevenths.push('flat');
  }

  if (majorSeventh >= SEVENTH_PRESENT) {
    sevenths.push('major');
  }

  return { third, sevenths, major, minor, flatSeventh, majorSeventh };
}

function strengthWord(ratio) {
  if (ratio >= 0.6) {
    return 'clear';
  }

  if (ratio >= 0.25) {
    return 'present';
  }

  if (ratio >= 0.1) {
    return 'faint';
  }

  return 'missing';
}

export function describeNotes(print, root, useFlats) {
  const reference = Math.max(print[root], print[(root + FIFTH) % 12], 1e-9);

  const notes = [
    ['root', 0],
    ['minor 3rd', MINOR_THIRD],
    ['major 3rd', MAJOR_THIRD],
    ['5th', FIFTH],
    ['flat 7th', FLAT_SEVENTH],
    ['major 7th', MAJOR_SEVENTH],
  ];

  return notes.map(([role, step]) => {
    const pitchClass = (root + step) % 12;

    return {
      role,
      name: noteName(pitchClass, useFlats),
      strength: strengthWord(print[pitchClass] / reference),
    };
  });
}

function buildItems(analysis, evidence) {
  return analysis.chords.map((chord, index) => {
    const parsed = parseChord(chord.label);

    if (!parsed) {
      return null;
    }

    const previous = parseChord(analysis.chords[index - 1]?.label);
    const next = parseChord(analysis.chords[index + 1]?.label);

    return {
      index,
      chord,
      root: parsed.root,
      rootName: parsed.rootName,
      seconds: chord.end - chord.start,
      context: `${previous?.root ?? '-'}/${next?.root ?? '-'}`,
      print: evidence ? fingerprint(evidence, chord.start, chord.end) : null,
    };
  }).filter(Boolean);
}

function averagePrint(items) {
  const totals = new Array(12).fill(0);
  let weight = 0;

  for (const item of items) {
    weight += item.seconds;

    for (let note = 0; note < 12; note++) {
      totals[note] += item.print[note] * item.seconds;
    }
  }

  return weight > 0 ? totals.map((value) => value / weight) : totals;
}

function seventhDiffers(first, second) {
  return (first >= SEVENTH_PRESENT && second < SEVENTH_PRESENT / 2)
    || (second >= SEVENTH_PRESENT && first < SEVENTH_PRESENT / 2);
}

function thirdClearlyMissingFromOne(firstReading, secondReading) {
  const strongest = (reading) => Math.max(reading.major, reading.minor);

  return (firstReading.third === 'none' && strongest(secondReading) >= THIRD_CLEAR)
    || (secondReading.third === 'none' && strongest(firstReading) >= THIRD_CLEAR);
}

function evidenceSeparates(first, second) {
  const firstReading = readThird(first.print, first.root);
  const secondReading = readThird(second.print, second.root);

  if (thirdClearlyMissingFromOne(firstReading, secondReading)) {
    return true;
  }

  if (first.chord.label === second.chord.label) {
    return false;
  }

  const thirds = new Set([firstReading.third, secondReading.third]);

  if (thirds.has('major') && thirds.has('minor')) {
    return true;
  }

  return seventhDiffers(firstReading.flatSeventh, secondReading.flatSeventh)
    || seventhDiffers(firstReading.majorSeventh, secondReading.majorSeventh);
}

function soundsAlike(first, second) {
  if (evidenceSeparates(first, second)) {
    return false;
  }

  const score = similarity(first.print, second.print);

  if (score >= SAME_SOUND) {
    return true;
  }

  return first.context === second.context && score >= SAME_SOUND_IN_CONTEXT;
}

function clusterByRoot(items) {
  const clusters = [];
  const byRoot = new Map();

  for (const item of items) {
    byRoot.set(item.root, [...(byRoot.get(item.root) ?? []), item]);
  }

  for (const members of byRoot.values()) {
    const remaining = [...members].sort((first, second) => second.seconds - first.seconds);

    while (remaining.length > 0) {
      const seed = remaining.shift();
      const cluster = [seed];

      for (let position = remaining.length - 1; position >= 0; position--) {
        const candidate = remaining[position];

        if (soundsAlike(seed, candidate)) {
          cluster.push(candidate);
          remaining.splice(position, 1);
        }
      }

      clusters.push(cluster.sort((first, second) => first.index - second.index));
    }
  }

  return clusters;
}

function mostCommonLabel(items) {
  const seconds = new Map();

  for (const item of items) {
    seconds.set(item.chord.label, (seconds.get(item.chord.label) ?? 0) + item.seconds);
  }

  return [...seconds.entries()].sort((first, second) => second[1] - first[1])[0][0];
}

function suggestName(items) {
  const edited = items.find((item) => item.chord.edited);

  if (edited) {
    return edited.chord.label;
  }

  const { rootName, root } = items[0];
  const { third, sevenths } = readThird(averagePrint(items), root);
  const common = mostCommonLabel(items);

  if (third === 'none') {
    return `${rootName}5`;
  }

  if (third === 'both') {
    return common;
  }

  const labelsHaveSeventh = items.some((item) => /7/.test(parseChord(item.chord.label).suffix));
  const minor = third === 'minor';
  let suffix = minor ? 'm' : '';

  if (labelsHaveSeventh && sevenths.includes('flat')) {
    suffix += '7';
  } else if (labelsHaveSeventh && sevenths.includes('major')) {
    suffix = minor ? 'mMaj7' : 'maj7';
  }

  return rootName + suffix;
}

function listNames(names) {
  if (names.length < 2) {
    return names.join('');
  }

  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function differentNamesFinding(cluster) {
  const names = [...new Set(cluster.map((item) => item.chord.label))];
  const suggestion = suggestName(cluster);
  const third = readThird(averagePrint(cluster), cluster[0].root).third;
  const thirdNote = {
    none: ' No clear 3rd can be heard.',
    both: ' Both a major and a minor 3rd can be heard.',
  }[third] ?? '';

  return {
    id: `names:${cluster[0].index}`,
    kind: 'different-names',
    indexes: cluster.map((item) => item.index),
    suggestion,
    message: `${listNames(names)} sound alike here (${cluster.length} chords).${thirdNote}`,
  };
}

function noThirdFindings(clusters) {
  const findings = [];

  for (const cluster of clusters) {
    const label = cluster[0].chord.label;
    const singleName = cluster.every((item) => item.chord.label === label);
    const others = clusters
      .filter((other) => other !== cluster && other[0].root === cluster[0].root)
      .flat()
      .filter((item) => item.chord.label === label);

    const tooFew = cluster.length < MINIMUM_COPIES_WITHOUT_THIRD;

    if (tooFew || !singleName || cluster.some((item) => item.chord.edited) || others.length === 0) {
      continue;
    }

    const here = readThird(averagePrint(cluster), cluster[0].root).third;
    const elsewhere = readThird(averagePrint(others), cluster[0].root).third;

    if (here === 'none' && (elsewhere === 'major' || elsewhere === 'minor')) {
      findings.push({
        id: `third:${cluster[0].index}`,
        kind: 'no-third',
        indexes: cluster.map((item) => item.index),
        suggestion: `${cluster[0].rootName}5`,
        message: `${cluster.length} of the ${label} chords have no clear 3rd, unlike the other ${others.length}.`,
      });
    }
  }

  return findings;
}

function sameSpotFindings(items, flagged) {
  const bySpot = new Map();

  for (const item of items) {
    if (!flagged.has(item.index) && !item.chord.edited) {
      bySpot.set(item.context, [...(bySpot.get(item.context) ?? []), item]);
    }
  }

  const findings = [];

  for (const members of bySpot.values()) {
    const labels = new Set(members.map((item) => item.chord.label));

    if (labels.size < 2) {
      continue;
    }

    const common = mostCommonLabel(members);
    const centre = averagePrint(members.filter((item) => item.chord.label === common));
    const alike = members.filter((item) => similarity(item.print, centre) >= SAME_SPOT_DIFFERENT_ROOT);
    const names = [...new Set(alike.map((item) => item.chord.label))];

    if (names.length < 2) {
      continue;
    }

    findings.push({
      id: `spot:${alike[0].index}`,
      kind: 'same-spot',
      indexes: alike.map((item) => item.index),
      suggestion: common,
      message: `${listNames(names)} sound alike and sit in the same spot (${alike.length} chords), so they may be one chord.`,
    });
  }

  return findings;
}

function oddOneOutFindings(items, flagged) {
  const byLabel = new Map();

  for (const item of items) {
    byLabel.set(item.chord.label, [...(byLabel.get(item.chord.label) ?? []), item]);
  }

  const findings = [];

  for (const [label, members] of byLabel) {
    if (members.length < MINIMUM_COPIES_FOR_ODD_ONE_OUT) {
      continue;
    }

    const odd = members.filter((item) => {
      if (flagged.has(item.index) || item.chord.edited) {
        return false;
      }

      const others = averagePrint(members.filter((member) => member !== item));

      return similarity(item.print, others) < ODD_ONE_OUT;
    });

    if (odd.length === 0) {
      continue;
    }

    findings.push({
      id: `odd:${odd[0].index}`,
      kind: 'odd-one-out',
      indexes: odd.map((item) => item.index),
      suggestion: null,
      atSeconds: odd[0].chord.start,
      message: odd.length === 1
        ? `This ${label} sounds different from the other ${members.length - 1}.`
        : `${odd.length} of the ${members.length} ${label} chords sound different from the rest.`,
    });
  }

  return findings;
}

export function checkChords(analysis, evidence) {
  if (!evidence) {
    return [];
  }

  const items = buildItems(analysis, evidence).filter(
    (item) => item.seconds >= SHORTEST_CHORD && !item.chord.checked,
  );

  const findings = [];
  const flagged = new Set();

  const clusters = clusterByRoot(items);

  for (const finding of noThirdFindings(clusters)) {
    findings.push(finding);
    finding.indexes.forEach((index) => flagged.add(index));
  }

  for (const cluster of clusters) {
    const names = new Set(cluster.map((item) => item.chord.label));
    const allEdited = cluster.every((item) => item.chord.edited);

    if (allEdited) {
      continue;
    }

    if (names.size > 1) {
      const finding = differentNamesFinding(cluster);

      findings.push(finding);
      finding.indexes.forEach((index) => flagged.add(index));
    }
  }

  for (const finding of sameSpotFindings(items, flagged)) {
    findings.push(finding);
    finding.indexes.forEach((index) => flagged.add(index));
  }

  findings.push(...oddOneOutFindings(items, flagged));

  return findings.sort((first, second) => first.indexes[0] - second.indexes[0]);
}

export function sameRootIndexes(analysis, index) {
  const target = parseChord(analysis.chords[index]?.label);

  if (!target) {
    return [index];
  }

  return analysis.chords.flatMap((chord, chordIndex) =>
    parseChord(chord.label)?.root === target.root ? [chordIndex] : [],
  );
}

export function similarCopies(analysis, evidence, index) {
  const chord = analysis.chords[index];

  if (!evidence) {
    return analysis.chords.flatMap((other, otherIndex) => (other.label === chord.label ? [otherIndex] : []));
  }

  const items = buildItems(analysis, evidence);
  const target = items.find((item) => item.index === index);

  if (!target) {
    return [index];
  }

  return items
    .filter(
      (item) =>
        item.index === index ||
        (item.root === target.root && soundsAlike(target, item)),
    )
    .map((item) => item.index);
}
