import { GUITAR_TUNING, MUTED, noteName } from './chord-shapes.mjs';

const SVG = 'http://www.w3.org/2000/svg';

const STRING_GAP = 16;
const FRET_GAP = 20;
const FRETS_SHOWN = 5;
const LEFT = 22;
const TOP = 26;
const DOT_RADIUS = 6;

const WHITE_WIDTH = 16;
const WHITE_HEIGHT = 64;
const BLACK_WIDTH = 10;
const BLACK_HEIGHT = 40;

// position of each black key's left edge inside its octave, in white key widths
const BLACK_KEYS = { 1: 0.65, 3: 1.75, 6: 3.6, 8: 4.7, 10: 5.8 };
const WHITE_INDEX = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 };

function element(name, attributes = {}, text = null) {
  const node = document.createElementNS(SVG, name);

  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, value);
  }

  if (text !== null) {
    node.textContent = text;
  }

  return node;
}

function findBarre(frets, firstFret) {
  const fretted = frets.filter((fret) => fret > 0);

  if (fretted.length < 4) {
    return null;
  }

  const lowest = Math.min(...fretted);
  const strings = frets.flatMap((fret, string) => (fret === lowest ? [string] : []));

  if (strings.length < 2 || lowest < firstFret) {
    return null;
  }

  const from = strings[0];
  const to = strings.at(-1);
  const covered = frets.slice(from, to + 1).every((fret) => fret >= lowest);

  return covered ? { fret: lowest, from, to } : null;
}

export function guitarDiagram(frets, rootPitchClass, title) {
  const fretted = frets.filter((fret) => fret > 0);
  const highest = fretted.length ? Math.max(...fretted) : 0;
  const lowest = fretted.length ? Math.min(...fretted) : 0;
  const firstFret = highest <= FRETS_SHOWN - 1 ? 1 : lowest;

  const width = LEFT + STRING_GAP * 5 + 14;
  const height = TOP + FRET_GAP * FRETS_SHOWN + 10;
  const svg = element('svg', {
    class: 'guitar-diagram',
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': title,
  });

  svg.append(element('title', {}, title));

  for (let string = 0; string < 6; string++) {
    const x = LEFT + string * STRING_GAP;
    svg.append(element('line', { class: 'string', x1: x, y1: TOP, x2: x, y2: TOP + FRET_GAP * FRETS_SHOWN }));
  }

  for (let line = 0; line <= FRETS_SHOWN; line++) {
    const y = TOP + line * FRET_GAP;
    const isNut = line === 0 && firstFret === 1;

    svg.append(element('line', {
      class: isNut ? 'nut' : 'fret',
      x1: LEFT,
      y1: y,
      x2: LEFT + STRING_GAP * 5,
      y2: y,
    }));
  }

  if (firstFret > 1) {
    svg.append(element('text', { class: 'fret-number', x: LEFT - 6, y: TOP + FRET_GAP * 0.65, 'text-anchor': 'end' }, `${firstFret}`));
  }

  const barre = findBarre(frets, firstFret);

  if (barre) {
    const y = TOP + (barre.fret - firstFret + 0.5) * FRET_GAP;

    svg.append(element('rect', {
      class: 'barre',
      x: LEFT + barre.from * STRING_GAP - DOT_RADIUS,
      y: y - DOT_RADIUS,
      width: (barre.to - barre.from) * STRING_GAP + DOT_RADIUS * 2,
      height: DOT_RADIUS * 2,
      rx: DOT_RADIUS,
    }));
  }

  frets.forEach((fret, string) => {
    const x = LEFT + string * STRING_GAP;

    if (fret === MUTED) {
      svg.append(element('text', { class: 'string-mark', x, y: TOP - 8, 'text-anchor': 'middle' }, '×'));
      return;
    }

    if (fret === 0) {
      svg.append(element('circle', { class: 'open-string', cx: x, cy: TOP - 12, r: 4 }));
      return;
    }

    const isRoot = (GUITAR_TUNING[string] + fret) % 12 === rootPitchClass;
    const onBarre = barre && fret === barre.fret && string >= barre.from && string <= barre.to;

    if (!onBarre || isRoot) {
      svg.append(element('circle', {
        class: isRoot ? 'dot root' : 'dot',
        cx: x,
        cy: TOP + (fret - firstFret + 0.5) * FRET_GAP,
        r: DOT_RADIUS,
      }));
    }
  });

  return svg;
}

export function pianoDiagram(voicing, title) {
  const notes = [...voicing.left, ...voicing.right];
  const lowOctave = Math.floor(Math.min(...notes) / 12);
  const highOctave = Math.max(lowOctave + 1, Math.floor(Math.max(...notes) / 12));
  const octaves = highOctave - lowOctave + 1;

  const width = octaves * 7 * WHITE_WIDTH + 2;
  const height = WHITE_HEIGHT + 2;
  const svg = element('svg', {
    class: 'piano-diagram',
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': title,
  });

  svg.append(element('title', {}, title));

  const pressed = (midi) => {
    if (voicing.left.includes(midi)) {
      return ' left';
    }

    return voicing.right.includes(midi) ? ' right' : '';
  };

  for (let octave = 0; octave < octaves; octave++) {
    for (const [pitchClass, index] of Object.entries(WHITE_INDEX)) {
      const midi = (lowOctave + octave) * 12 + Number(pitchClass);

      svg.append(element('rect', {
        class: `white-key${pressed(midi)}`,
        x: 1 + (octave * 7 + index) * WHITE_WIDTH,
        y: 1,
        width: WHITE_WIDTH,
        height: WHITE_HEIGHT,
      }));
    }
  }

  for (let octave = 0; octave < octaves; octave++) {
    for (const [pitchClass, offset] of Object.entries(BLACK_KEYS)) {
      const midi = (lowOctave + octave) * 12 + Number(pitchClass);

      svg.append(element('rect', {
        class: `black-key${pressed(midi)}`,
        x: 1 + (octave * 7 + offset) * WHITE_WIDTH,
        y: 1,
        width: BLACK_WIDTH,
        height: BLACK_HEIGHT,
      }));
    }
  }

  return svg;
}

export function describePianoVoicing(voicing) {
  const names = (notes) => notes.map(noteName).join(' ');

  return `Left hand ${names(voicing.left)}, right hand ${names(voicing.right)}`;
}
