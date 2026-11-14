const PITCH_CLASSES = {
  C: 0, 'B#': 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4, F: 5, 'E#': 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11,
};

// the spellings guitarists usually use for each pitch
const SHAPE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

// standard tuning as MIDI note numbers, low E string first
export const GUITAR_TUNING = [40, 45, 50, 55, 59, 64];

export const MUTED = -1;

// semitones above the root for each chord quality
const QUALITIES = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  five: [0, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  six: [0, 4, 7, 9],
  min6: [0, 3, 7, 9],
  dom7: [0, 4, 7, 10],
  min7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  minMaj7: [0, 3, 7, 11],
  dim7: [0, 3, 6, 9],
  halfDim7: [0, 3, 6, 10],
  sus4dom7: [0, 5, 7, 10],
  add9: [0, 4, 7, 14],
  dom9: [0, 4, 7, 10, 14],
  min9: [0, 3, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
};

const SUFFIXES = {
  '': 'maj', maj: 'maj', M: 'maj',
  m: 'min', min: 'min', '-': 'min',
  5: 'five',
  dim: 'dim', o: 'dim',
  aug: 'aug', '+': 'aug',
  sus2: 'sus2',
  sus4: 'sus4', sus: 'sus4',
  6: 'six',
  m6: 'min6', min6: 'min6',
  7: 'dom7',
  m7: 'min7', min7: 'min7', '-7': 'min7',
  maj7: 'maj7', M7: 'maj7',
  mMaj7: 'minMaj7', mM7: 'minMaj7', mmaj7: 'minMaj7',
  dim7: 'dim7', o7: 'dim7',
  m7b5: 'halfDim7', 'ø': 'halfDim7',
  '7sus4': 'sus4dom7', '7sus': 'sus4dom7',
  add9: 'add9', add2: 'add9',
  9: 'dom9',
  m9: 'min9',
  maj9: 'maj9',
};

// movable shapes, as frets relative to the root's fret; MUTED marks a string not played
const ROOT_ON_SIXTH = {
  maj: [0, 2, 2, 1, 0, 0],
  min: [0, 2, 2, 0, 0, 0],
  dom7: [0, 2, 0, 1, 0, 0],
  min7: [0, 2, 0, 0, 0, 0],
  maj7: [0, MUTED, 1, 1, 0, MUTED],
  minMaj7: [0, 2, 1, 0, 0, 0],
  six: [0, 2, 2, 1, 2, 0],
  min6: [0, 2, 2, 0, 2, 0],
  sus4: [0, 2, 2, 2, 0, 0],
  dim: [0, 1, 2, 0, MUTED, MUTED],
  aug: [0, 3, 2, 1, 1, 0],
  five: [0, 2, 2, MUTED, MUTED, MUTED],
  dim7: [0, 1, 2, 0, 2, 0],
  halfDim7: [0, 1, 0, 0, MUTED, MUTED],
  sus4dom7: [0, 2, 0, 2, 0, 0],
  dom9: [0, 2, 0, 1, 0, 2],
};

const ROOT_ON_FIFTH = {
  maj: [MUTED, 0, 2, 2, 2, 0],
  min: [MUTED, 0, 2, 2, 1, 0],
  dom7: [MUTED, 0, 2, 0, 2, 0],
  min7: [MUTED, 0, 2, 0, 1, 0],
  maj7: [MUTED, 0, 2, 1, 2, 0],
  minMaj7: [MUTED, 0, 2, 1, 1, 0],
  six: [MUTED, 0, 2, 2, 2, 2],
  min6: [MUTED, 0, 2, 2, 1, 2],
  sus4: [MUTED, 0, 2, 2, 3, 0],
  sus2: [MUTED, 0, 2, 2, 0, 0],
  dim: [MUTED, 0, 1, 2, 1, MUTED],
  aug: [MUTED, 0, 3, 2, 2, 1],
  five: [MUTED, 0, 2, 2, MUTED, MUTED],
  dim7: [MUTED, 0, 1, 2, 1, 2],
  halfDim7: [MUTED, 0, 1, 0, 1, MUTED],
  sus4dom7: [MUTED, 0, 2, 0, 3, 0],
  add9: [MUTED, 0, 2, 4, 2, 0],
  dom9: [MUTED, 0, 2, 4, 2, 3],
};

const ROOT_ON_FOURTH = {
  maj: [MUTED, MUTED, 0, 2, 3, 2],
  min: [MUTED, MUTED, 0, 2, 3, 1],
  dom7: [MUTED, MUTED, 0, 2, 1, 2],
  min7: [MUTED, MUTED, 0, 2, 1, 1],
  maj7: [MUTED, MUTED, 0, 2, 2, 2],
  sus2: [MUTED, MUTED, 0, 2, 3, 0],
  sus4: [MUTED, MUTED, 0, 2, 3, 3],
  six: [MUTED, MUTED, 0, 2, 0, 2],
  min6: [MUTED, MUTED, 0, 2, 0, 1],
  dim: [MUTED, MUTED, 0, 1, 3, 1],
};

const MOVABLE_SHAPES = [
  { string: 0, shapes: ROOT_ON_SIXTH },
  { string: 1, shapes: ROOT_ON_FIFTH },
  { string: 2, shapes: ROOT_ON_FOURTH },
];

// well known open shapes that don't come from moving one of the shapes above
const OPEN_SHAPES = {
  'C:maj': [MUTED, 3, 2, 0, 1, 0],
  'C:dom7': [MUTED, 3, 2, 3, 1, 0],
  'C:maj7': [MUTED, 3, 2, 0, 0, 0],
  'C:add9': [MUTED, 3, 2, 0, 3, 0],
  'C:sus4': [MUTED, 3, 3, 0, 1, 1],
  'G:maj': [3, 2, 0, 0, 0, 3],
  'G:dom7': [3, 2, 0, 0, 0, 1],
  'G:maj7': [3, 2, 0, 0, 0, 2],
  'G:six': [3, 2, 0, 0, 0, 0],
  'G:sus4': [3, 3, 0, 0, 1, 3],
  'B:dom7': [MUTED, 2, 1, 2, 0, 2],
  'F:maj7': [MUTED, MUTED, 3, 2, 1, 0],
};

const HIGHEST_FRET = 15;
const SEARCH_SPAN = 3;
const MOST_FINGERS = 4;
const MOST_SHAPES = 4;

// how strongly a well known open shape is preferred over others with a similar score
const FAMILIAR_BONUS = 3;

// an "easy" shape stays in the first three frets with no barre
const EASY_HIGHEST_FRET = 3;
const HIGHEST_CAPO = 7;

// a capo must make this much more of the song easy to be worth suggesting
const CAPO_GAIN = 0.15;

// each fret of capo counts against it a little, since higher capos change the sound more
const CAPO_COST = 0.02;

export function parseChord(label) {
  const match = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec((label ?? '').trim());

  if (!match || !(match[1] in PITCH_CLASSES)) {
    return null;
  }

  const [, rootName, suffix, bassName] = match;
  let quality = SUFFIXES[suffix];

  if (!quality) {
    quality = /^m(?!aj)/.test(suffix) ? 'min' : 'maj';
  }

  if (bassName && !(bassName in PITCH_CLASSES)) {
    return null;
  }

  const root = PITCH_CLASSES[rootName];
  const bass = bassName ? PITCH_CLASSES[bassName] : root;

  return {
    label: label.trim(),
    rootName,
    root,
    suffix,
    quality,
    exact: suffix in SUFFIXES,
    bassName: bassName ?? null,
    bass,
    pitchClasses: [...new Set(QUALITIES[quality].map((step) => (root + step) % 12))],
  };
}

export function transposeChord(label, semitones) {
  const chord = parseChord(label);

  if (!chord) {
    return label;
  }

  const shift = (pitchClass) => SHAPE_NAMES[(pitchClass + semitones + 120) % 12];
  const bass = chord.bassName ? `/${shift(chord.bass)}` : '';

  return `${shift(chord.root)}${chord.suffix}${bass}`;
}

export function soundingNotes(frets) {
  return frets.flatMap((fret, string) => (fret === MUTED ? [] : [GUITAR_TUNING[string] + fret]));
}

function lowestNote(frets) {
  return Math.min(...soundingNotes(frets));
}

export function fitsChord(frets, chord) {
  const notes = soundingNotes(frets);

  if (notes.length < 3 && chord.quality !== 'five') {
    return false;
  }

  const classes = new Set(notes.map((note) => note % 12));
  const allowed = new Set([...chord.pitchClasses, chord.bass]);

  if ([...classes].some((pitchClass) => !allowed.has(pitchClass))) {
    return false;
  }

  // a fifth can be left out of bigger chords, as guitarists often do
  const fifth = (chord.root + 7) % 12;
  const needed = chord.pitchClasses.filter((pitchClass) => chord.pitchClasses.length < 4 || pitchClass !== fifth);

  return needed.every((pitchClass) => classes.has(pitchClass)) && lowestNote(frets) % 12 === chord.bass;
}

function placeMovable(template, rootString, rootPitch) {
  const openPitch = GUITAR_TUNING[rootString] % 12;
  const fret = (rootPitch - openPitch + 12) % 12;
  const placed = [];

  for (const base of [fret, fret + 12]) {
    const frets = template.map((offset) => (offset === MUTED ? MUTED : base + offset));

    if (frets.every((value) => value === MUTED || (value >= 0 && value <= HIGHEST_FRET))) {
      placed.push(frets);
    }
  }

  return placed;
}

function fingersNeeded(frets) {
  const fretted = frets.filter((fret) => fret > 0);

  if (fretted.length === 0) {
    return 0;
  }

  const lowest = Math.min(...fretted);
  const onLowest = fretted.filter((fret) => fret === lowest).length;

  // several strings on the lowest fret can share one finger as a barre
  return fretted.length - onLowest + 1;
}

function addBass(frets, chord) {
  if (lowestNote(frets) % 12 === chord.bass) {
    return frets;
  }

  const fretted = frets.filter((fret) => fret > 0);
  const lowestFret = fretted.length ? Math.min(...fretted) : 0;

  for (let string = 0; string < 2; string++) {
    for (let fret = Math.max(0, lowestFret - 2); fret <= lowestFret + 3; fret++) {
      if ((GUITAR_TUNING[string] + fret) % 12 !== chord.bass) {
        continue;
      }

      const candidate = frets.map((value, index) => {
        if (index < string) {
          return MUTED;
        }

        return index === string ? fret : value;
      });

      if (fitsChord(candidate, chord) && fingersNeeded(candidate) <= MOST_FINGERS) {
        return candidate;
      }
    }
  }

  return null;
}

function searchShapes(chord) {
  const allowed = new Set([...chord.pitchClasses, chord.bass]);
  const found = [];

  for (let base = 0; base <= 12; base++) {
    const options = GUITAR_TUNING.map((open) => {
      const choices = [MUTED];

      if (base <= 3 && allowed.has(open % 12)) {
        choices.push(0);
      }

      for (let fret = Math.max(1, base); fret <= base + SEARCH_SPAN; fret++) {
        if (allowed.has((open + fret) % 12)) {
          choices.push(fret);
        }
      }

      return choices;
    });

    const walk = (string, frets) => {
      if (string === GUITAR_TUNING.length) {
        const sounding = frets.filter((fret) => fret !== MUTED).length;
        const firstPlayed = frets.findIndex((fret) => fret !== MUTED);
        const gaps = frets.slice(firstPlayed).some((fret) => fret === MUTED);

        if (sounding >= 4 && !gaps && fingersNeeded(frets) <= MOST_FINGERS && fitsChord(frets, chord)) {
          found.push([...frets]);
        }

        return;
      }

      for (const fret of options[string]) {
        frets.push(fret);
        walk(string + 1, frets);
        frets.pop();
      }
    };

    walk(0, []);
  }

  return found;
}

function shapeScore(frets) {
  const fretted = frets.filter((fret) => fret > 0);
  const highest = fretted.length ? Math.max(...fretted) : 0;
  const lowest = fretted.length ? Math.min(...fretted) : 0;
  const open = frets.filter((fret) => fret === 0).length;
  const muted = frets.filter((fret) => fret === MUTED).length;

  return lowest * 1.5 + (highest - lowest) * 1.2 + muted * 0.6 - open * 0.4 + fingersNeeded(frets) * 0.3;
}

export function isEasyShape(frets) {
  const fretted = frets.filter((fret) => fret > 0);

  if (fretted.length === 0) {
    return true;
  }

  const lowest = Math.min(...fretted);
  const barre = fretted.filter((fret) => fret === lowest).length >= 3 && lowest > 0 && !frets.includes(0);

  return Math.max(...fretted) <= EASY_HIGHEST_FRET && !barre && fingersNeeded(frets) <= MOST_FINGERS;
}

export function guitarShapes(label) {
  const chord = parseChord(label);

  if (!chord) {
    return [];
  }

  const candidates = [];
  const known = OPEN_SHAPES[`${SHAPE_NAMES[chord.root]}:${chord.quality}`]
    ?? OPEN_SHAPES[`${chord.rootName}:${chord.quality}`];

  if (known) {
    candidates.push(known);
  }

  for (const { string, shapes } of MOVABLE_SHAPES) {
    const template = shapes[chord.quality];

    if (template) {
      candidates.push(...placeMovable(template, string, chord.root));
    }
  }

  const familiar = known ? addBass(known, chord) : null;

  let shapes = candidates
    .map((frets) => addBass(frets, chord))
    .filter((frets) => frets && fitsChord(frets, chord));

  if (shapes.length < 2) {
    shapes = [...shapes, ...searchShapes(chord)];
  }

  const unique = new Map();

  for (const frets of shapes) {
    unique.set(frets.join(','), frets);
  }

  const score = (frets) => shapeScore(frets) - (familiar && frets.join() === familiar.join() ? FAMILIAR_BONUS : 0);

  return [...unique.values()]
    .sort((first, second) => score(first) - score(second))
    .slice(0, MOST_SHAPES);
}

export function suggestCapo(chords) {
  const seconds = new Map();

  for (const chord of chords) {
    if (parseChord(chord.label)) {
      seconds.set(chord.label, (seconds.get(chord.label) ?? 0) + (chord.end - chord.start));
    }
  }

  const total = [...seconds.values()].reduce((sum, value) => sum + value, 0);

  if (total === 0) {
    return { capo: 0, easyShare: 0, withoutCapo: 0 };
  }

  const easyShare = (capo) => {
    let easy = 0;

    for (const [label, duration] of seconds) {
      const shapes = guitarShapes(transposeChord(label, -capo));

      if (shapes.some(isEasyShape)) {
        easy += duration;
      }
    }

    return easy / total;
  };

  const withoutCapo = easyShare(0);
  const worth = (capo, share) => share - capo * CAPO_COST;
  let best = { capo: 0, easyShare: withoutCapo };

  for (let capo = 1; capo <= HIGHEST_CAPO; capo++) {
    const share = easyShare(capo);

    if (worth(capo, share) > worth(best.capo, best.easyShare) + 1e-9) {
      best = { capo, easyShare: share };
    }
  }

  if (worth(best.capo, best.easyShare) - withoutCapo < CAPO_GAIN) {
    best = { capo: 0, easyShare: withoutCapo };
  }

  return { ...best, withoutCapo };
}

// right hand notes sit around here, so voicings don't wander up or down the keyboard
const RIGHT_HAND_CENTRE = 64;
const LEFT_HAND_LOW = 36;

function rightHandRootPosition(chord) {
  let root = 60 + chord.root;

  if (root > 66) {
    root -= 12;
  }

  return QUALITIES[chord.quality]
    .map((step) => root + (step > 12 ? step - 12 : step))
    .filter((note, index, notes) => notes.indexOf(note) === index)
    .sort((first, second) => first - second);
}

function inversions(notes) {
  const all = [notes];

  for (let turn = 1; turn < notes.length; turn++) {
    const previous = all[turn - 1];
    all.push([...previous.slice(1), previous[0] + 12]);
  }

  return all.flatMap((voicing) => [voicing, voicing.map((note) => note - 12)]);
}

function centreOf(notes) {
  return notes.reduce((sum, note) => sum + note, 0) / notes.length;
}

function movement(from, to) {
  const count = Math.min(from.length, to.length);
  let total = 0;

  for (let index = 0; index < count; index++) {
    total += Math.abs(from[index] - to[index]);
  }

  return total + Math.abs(from.length - to.length) * 2;
}

export function pianoVoicing(label, { smooth = false, previous = null } = {}) {
  const chord = parseChord(label);

  if (!chord) {
    return null;
  }

  const rootPosition = rightHandRootPosition(chord);
  let right = rootPosition;

  if (smooth) {
    const choices = inversions(rootPosition).filter((notes) => notes[0] >= 52 && notes.at(-1) <= 79);

    right = choices.reduce((best, notes) => {
      const cost = previous
        ? movement(previous, notes)
        : Math.abs(centreOf(notes) - RIGHT_HAND_CENTRE);
      const bestCost = previous
        ? movement(previous, best)
        : Math.abs(centreOf(best) - RIGHT_HAND_CENTRE);

      return cost < bestCost ? notes : best;
    }, choices[0] ?? rootPosition);
  }

  let left = LEFT_HAND_LOW + ((chord.bass - LEFT_HAND_LOW % 12 + 12) % 12);

  if (left + 12 < right[0] - 7) {
    left += 12;
  }

  return { left: [left], right };
}

export function pianoVoicings(labels, smooth) {
  const voicings = [];
  let previous = null;

  for (const label of labels) {
    const voicing = pianoVoicing(label, { smooth, previous });
    voicings.push(voicing);

    if (voicing) {
      previous = voicing.right;
    }
  }

  return voicings;
}

export function noteName(midi) {
  return SHAPE_NAMES[midi % 12];
}
