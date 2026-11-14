export const GUITAR_STRINGS = { tuning: [40, 45, 50, 55, 59, 64], names: ['E', 'A', 'D', 'G', 'B', 'e'] };
export const BASS_STRINGS = { tuning: [28, 33, 38, 43], names: ['E', 'A', 'D', 'G'] };

const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

const HIGHEST_FRET = 20;

// notes starting this close together, in seconds, are played as one chord
const TOGETHER = 0.04;

// how many fingerings of a chord are compared before picking one
const MOST_CHORD_OPTIONS = 24;

// cost of moving the hand one fret along the neck between notes
const MOVE_COST = 0.6;

// cost of each fret a chord's fingering stretches across
const STRETCH_COST = 1.0;

// small extra cost for playing high up the neck
const HIGH_FRET_COST = 0.05;

// the part of a beat each tab column stands for: 4 means sixteenth notes
const COLUMNS_PER_BEAT = 4;
const COLUMN_WIDTH = 3;
const BARS_PER_ROW = 2;
const FALLBACK_BAR_SECONDS = 2.4;

export function noteLabel(midi) {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

export function groupNotes(notes) {
  const sorted = [...notes].sort((first, second) => first[0] - second[0] || first[2] - second[2]);
  const groups = [];

  for (const note of sorted) {
    const group = groups.at(-1);

    if (group && note[0] - group[0][0] <= TOGETHER) {
      group.push(note);
    } else {
      groups.push([note]);
    }
  }

  return groups;
}

function fretOptions(pitch, tuning) {
  return tuning.flatMap((open, string) => {
    const fret = pitch - open;
    return fret >= 0 && fret <= HIGHEST_FRET ? [{ string, fret }] : [];
  });
}

function handPosition(fingering) {
  const fretted = fingering.filter((place) => place.fret > 0).map((place) => place.fret);
  return fretted.length ? fretted.reduce((sum, fret) => sum + fret, 0) / fretted.length : null;
}

function stretch(fingering) {
  const fretted = fingering.filter((place) => place.fret > 0).map((place) => place.fret);
  return fretted.length ? Math.max(...fretted) - Math.min(...fretted) : 0;
}

function chordFingerings(group, tuning) {
  const pitches = [...new Set(group.map((note) => note[2]))].sort((first, second) => first - second);
  const playable = pitches.slice(0, tuning.length);
  const results = [];

  const walk = (index, used, chosen) => {
    if (results.length >= MOST_CHORD_OPTIONS * 8) {
      return;
    }

    if (index === playable.length) {
      results.push([...chosen]);
      return;
    }

    for (const option of fretOptions(playable[index], tuning)) {
      if (!used.has(option.string)) {
        used.add(option.string);
        chosen.push({ ...option, pitch: playable[index] });
        walk(index + 1, used, chosen);
        chosen.pop();
        used.delete(option.string);
      }
    }
  };

  walk(0, new Set(), []);

  return results
    .filter((fingering) => stretch(fingering) <= 5)
    .sort((first, second) => stretch(first) - stretch(second))
    .slice(0, MOST_CHORD_OPTIONS);
}

function singleOptions(note, tuning) {
  return fretOptions(note[2], tuning).map((option) => [{ ...option, pitch: note[2] }]);
}

export function assignFrets(notes, strings = GUITAR_STRINGS) {
  const candidates = groupNotes(notes).map((group) => {
    if (group.length === 1) {
      return { group, choices: singleOptions(group[0], strings.tuning) };
    }

    const chords = chordFingerings(group, strings.tuning);

    if (chords.length) {
      return { group, choices: chords };
    }

    // a chord that can't be fingered is reduced to its highest playable note, usually the melody
    const highestFirst = [...group].sort((first, second) => second[2] - first[2]);
    const reachable = highestFirst.find((note) => singleOptions(note, strings.tuning).length > 0);

    return { group, choices: reachable ? singleOptions(reachable, strings.tuning) : [] };
  });

  const playable = candidates.filter((candidate) => candidate.choices.length > 0);
  const groups = playable.map((candidate) => candidate.group);
  const options = playable.map((candidate) => candidate.choices);

  // best: for each fingering of the current group, the lowest total cost and where it came from
  let best = options[0]?.map((fingering) => ({
    cost: stretch(fingering) * STRETCH_COST + (handPosition(fingering) ?? 0) * HIGH_FRET_COST,
    from: -1,
  })) ?? [];

  const history = [best];

  for (let index = 1; index < groups.length; index++) {
    const previous = options[index - 1];

    best = options[index].map((fingering) => {
      const here = handPosition(fingering);
      let choice = { cost: Infinity, from: -1 };

      previous.forEach((before, beforeIndex) => {
        const there = handPosition(before);
        const move = here === null || there === null ? 0 : Math.abs(here - there);
        const cost = history[index - 1][beforeIndex].cost
          + move * MOVE_COST
          + stretch(fingering) * STRETCH_COST
          + (here ?? 0) * HIGH_FRET_COST;

        if (cost < choice.cost) {
          choice = { cost, from: beforeIndex };
        }
      });

      return choice;
    });

    history.push(best);
  }

  if (groups.length === 0 || best.length === 0) {
    return [];
  }

  const picked = new Array(groups.length);
  let current = best.reduce((lowest, entry, index) => (entry.cost < best[lowest].cost ? index : lowest), 0);

  for (let index = groups.length - 1; index >= 0; index--) {
    picked[index] = options[index][current];
    current = history[index][current].from;
  }

  return groups.flatMap((group, index) => (picked[index] ?? []).map((place) => ({
    start: group[0][0],
    pitch: place.pitch,
    string: place.string,
    fret: place.fret,
  })));
}

export function barEdges(start, end, downbeats) {
  const inside = (downbeats ?? []).filter((time) => time > start + 0.05 && time < end - 0.05);

  if (inside.length >= 1) {
    const first = (downbeats ?? []).filter((time) => time <= start + 0.05).at(-1);
    return [first ?? start, ...inside, end];
  }

  const edges = [];

  for (let time = start; time < end - 0.05; time += FALLBACK_BAR_SECONDS) {
    edges.push(time);
  }

  return [...edges, end];
}

function formatTime(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function buildTab(notes, { strings = GUITAR_STRINGS, start, end, downbeats, beatsPerBar = 4 }) {
  const placed = assignFrets(notes.filter((note) => note[0] >= start - 0.05 && note[0] < end), strings);
  const edges = barEdges(start, end, downbeats);
  const columns = beatsPerBar * COLUMNS_PER_BEAT;
  const bars = [];

  for (let index = 0; index < edges.length - 1; index++) {
    const barStart = edges[index];
    const barEnd = edges[index + 1];
    const grid = strings.tuning.map(() => new Array(columns).fill(null));

    for (const place of placed) {
      if (place.start < barStart - 0.05 || place.start >= barEnd - 0.05) {
        continue;
      }

      const column = Math.min(columns - 1, Math.max(0, Math.round(((place.start - barStart) / (barEnd - barStart)) * columns)));

      if (grid[place.string][column] === null) {
        grid[place.string][column] = place.fret;
      }
    }

    bars.push({ start: barStart, grid });
  }

  const rows = [];

  for (let first = 0; first < bars.length; first += BARS_PER_ROW) {
    const group = bars.slice(first, first + BARS_PER_ROW);
    const lines = [`   ${formatTime(group[0].start)}`];

    for (let string = strings.tuning.length - 1; string >= 0; string--) {
      const cells = group.map((bar) => bar.grid[string]
        .map((fret) => (fret === null ? '-'.repeat(COLUMN_WIDTH) : String(fret).padEnd(COLUMN_WIDTH, '-')))
        .join(''));

      lines.push(`${strings.names[string].padEnd(2)}|${cells.join('|')}|`);
    }

    rows.push(lines.join('\n'));
  }

  return rows.join('\n\n');
}

export function buildNoteNames(notes, { start, end, downbeats }) {
  const edges = barEdges(start, end, downbeats);
  const lines = [];

  for (let index = 0; index < edges.length - 1; index++) {
    const inBar = groupNotes(notes.filter((note) => note[0] >= edges[index] - 0.05 && note[0] < edges[index + 1] - 0.05));

    if (inBar.length === 0) {
      continue;
    }

    const names = inBar.map((group) => (
      group.length === 1
        ? noteLabel(group[0][2])
        : `(${group.map((note) => noteLabel(note[2])).join(' ')})`
    ));

    lines.push(`${formatTime(edges[index]).padStart(5)}  ${names.join(' ')}`);
  }

  return lines.join('\n');
}
