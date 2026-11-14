import { NO_CHORD, currentAndNextChord, findIndexAt } from './chart.mjs';
import {
  guitarShapes,
  parseChord,
  pianoVoicings,
  suggestCapo,
  transposeChord,
} from './chord-shapes.mjs';
import { describePianoVoicing, guitarDiagram, pianoDiagram } from './diagrams.mjs';

const HIGHEST_CAPO = 9;
const SETTINGS_PREFIX = 'guides:';

function createButton(label, onClick) {
  const button = document.createElement('button');

  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', onClick);

  return button;
}

function readSettings(songId) {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_PREFIX + songId)) ?? {};
  } catch {
    return {};
  }
}

function writeSettings(songId, settings) {
  try {
    localStorage.setItem(SETTINGS_PREFIX + songId, JSON.stringify(settings));
  } catch {
    return;
  }
}

export class GuidesView {
  constructor({ getPosition, getSongId }) {
    this.getPosition = getPosition;
    this.getSongId = getSongId;

    this.analysis = null;
    this.settings = { instrument: 'guitar', capo: null, smooth: true, shapes: {} };
    this.suggestion = { capo: 0, easyShare: 0, withoutCapo: 0 };
    this.cards = new Map();
    this.pianoByIndex = [];
    this.nowIndex = null;
    this.nextIndex = null;

    this.message = document.getElementById('guides-message');
    this.instrumentButtons = [...document.querySelectorAll('#guides-instrument button')];
    this.capoLabel = document.getElementById('guides-capo-label');
    this.capoSelect = document.getElementById('guides-capo');
    this.capoNote = document.getElementById('guides-capo-note');
    this.smoothLabel = document.getElementById('guides-smooth-label');
    this.smoothBox = document.getElementById('guides-smooth');
    this.nowCard = document.getElementById('guide-now');
    this.nextCard = document.getElementById('guide-next');
    this.grid = document.getElementById('guides-grid');
    this.content = document.getElementById('guides-content');

    for (let capo = 0; capo <= HIGHEST_CAPO; capo++) {
      this.capoSelect.append(new Option(capo === 0 ? 'No capo' : `Fret ${capo}`, String(capo)));
    }

    for (const button of this.instrumentButtons) {
      button.addEventListener('click', () => {
        this.settings.instrument = button.dataset.instrument;
        this.saveAndRender();
      });
    }

    this.capoSelect.addEventListener('change', () => {
      this.settings.capo = Number(this.capoSelect.value);
      this.saveAndRender();
    });

    this.smoothBox.addEventListener('change', () => {
      this.settings.smooth = this.smoothBox.checked;
      this.saveAndRender();
    });
  }

  setAnalysis(analysis) {
    const songId = this.getSongId();

    this.analysis = analysis;
    this.settings = { instrument: 'guitar', capo: null, smooth: true, shapes: {}, ...readSettings(songId) };
    this.suggestion = analysis ? suggestCapo(analysis.chords) : { capo: 0, easyShare: 0, withoutCapo: 0 };
    this.render();
  }

  refresh(analysis) {
    this.analysis = analysis;
    this.suggestion = suggestCapo(analysis.chords);
    this.render();
  }

  saveAndRender() {
    writeSettings(this.getSongId(), this.settings);
    this.render();
  }

  capo() {
    return this.settings.capo ?? this.suggestion.capo;
  }

  songLabels() {
    const seen = new Set();
    const labels = [];

    for (const chord of this.analysis?.chords ?? []) {
      if (chord.label !== NO_CHORD && !seen.has(chord.label)) {
        seen.add(chord.label);
        labels.push(chord.label);
      }
    }

    return labels;
  }

  render() {
    const hasChords = this.songLabels().length > 0;

    this.content.hidden = !hasChords;
    this.message.textContent = hasChords ? '' : 'Chord guides appear once the song has been analysed.';
    this.cards = new Map();
    this.nowIndex = null;
    this.nextIndex = null;

    if (!hasChords) {
      this.grid.replaceChildren();
      return;
    }

    const guitar = this.settings.instrument === 'guitar';

    for (const button of this.instrumentButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.instrument === this.settings.instrument));
    }

    this.capoLabel.hidden = !guitar;
    this.capoNote.hidden = !guitar;
    this.smoothLabel.hidden = guitar;
    this.capoSelect.value = String(this.capo());
    this.smoothBox.checked = this.settings.smooth;
    this.capoNote.textContent = this.describeCapo();

    this.pianoByIndex = guitar
      ? []
      : pianoVoicings(this.analysis.chords.map((chord) => chord.label), this.settings.smooth);

    this.grid.replaceChildren(...this.songLabels().map((label) => {
      const card = this.createCard(label, this.firstIndexOf(label));
      this.cards.set(label, card);
      return card;
    }));

    this.update(this.getPosition());
  }

  describeCapo() {
    const { capo, easyShare, withoutCapo } = this.suggestion;
    const percent = (share) => `${Math.round(share * 100)}%`;

    if (capo === 0) {
      return `No capo needed: ${percent(withoutCapo)} of the song uses easy open shapes.`;
    }

    return `Suggested: capo on fret ${capo}, which makes ${percent(easyShare)} of the song easy open shapes, up from ${percent(withoutCapo)}.`;
  }

  firstIndexOf(label) {
    return this.analysis.chords.findIndex((chord) => chord.label === label);
  }

  createCard(label, chordIndex, heading = null) {
    const card = document.createElement('figure');
    card.className = 'guide-card';

    const caption = document.createElement('figcaption');
    caption.textContent = heading ? `${heading}: ${label}` : label;
    card.append(caption);

    if (this.settings.instrument === 'guitar') {
      this.fillGuitarCard(card, label);
    } else {
      this.fillPianoCard(card, label, chordIndex);
    }

    return card;
  }

  fillGuitarCard(card, label) {
    const capo = this.capo();
    const shapeLabel = transposeChord(label, -capo);
    const shapes = guitarShapes(shapeLabel);
    const chord = parseChord(shapeLabel);

    if (!chord || shapes.length === 0) {
      card.append(this.note('No diagram for this chord name.'));
      return;
    }

    const chosen = Math.min(this.settings.shapes[label] ?? 0, shapes.length - 1);

    if (capo > 0) {
      card.append(this.note(`Play the ${shapeLabel} shape`));
    }

    card.append(guitarDiagram(shapes[chosen], chord.root, `${label}, shape ${chosen + 1}`));

    if (!chord.exact) {
      card.append(this.note('Simplified: the full chord needs extra notes.'));
    }

    if (shapes.length > 1) {
      const controls = document.createElement('div');
      controls.className = 'guide-shape-controls';

      const step = (offset) => {
        this.settings.shapes[label] = (chosen + offset + shapes.length) % shapes.length;
        this.saveAndRender();
      };

      controls.append(
        createButton('‹', () => step(-1)),
        this.note(`Shape ${chosen + 1} of ${shapes.length}`),
        createButton('›', () => step(1)),
      );

      card.append(controls);
    }
  }

  fillPianoCard(card, label, chordIndex) {
    const voicing = this.pianoByIndex[chordIndex];

    if (!voicing) {
      card.append(this.note('No diagram for this chord name.'));
      return;
    }

    card.append(pianoDiagram(voicing, label), this.note(describePianoVoicing(voicing)));

    if (!parseChord(label).exact) {
      card.append(this.note('Simplified: the full chord needs extra notes.'));
    }
  }

  note(text) {
    const span = document.createElement('span');
    span.className = 'note';
    span.textContent = text;
    return span;
  }

  update(seconds) {
    if (!this.analysis || this.cards.size === 0) {
      return;
    }

    const chords = this.analysis.chords;
    const { current, next } = currentAndNextChord(chords, seconds);
    const nowIndex = current ? findIndexAt(chords, seconds) : -1;
    const nextIndex = next ? nowIndex + 1 : -1;

    if (nowIndex === this.nowIndex && nextIndex === this.nextIndex) {
      return;
    }

    this.nowIndex = nowIndex;
    this.nextIndex = nextIndex;

    this.fillSlot(this.nowCard, 'Now', nowIndex);
    this.fillSlot(this.nextCard, 'Next', nextIndex);

    for (const [label, card] of this.cards) {
      card.classList.toggle('current', current?.label === label);
    }
  }

  fillSlot(slot, heading, chordIndex) {
    const chord = this.analysis.chords[chordIndex];

    if (!chord || chord.label === NO_CHORD) {
      const empty = document.createElement('figure');
      empty.className = 'guide-card';
      empty.append(this.note(`${heading}: no chord`));
      slot.replaceChildren(empty);
      return;
    }

    slot.replaceChildren(this.createCard(chord.label, chordIndex, heading));
  }
}
