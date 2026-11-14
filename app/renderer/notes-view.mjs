import { BASS_STRINGS, GUITAR_STRINGS, buildNoteNames, buildTab, noteLabel } from './tab.mjs';

const PART_NAMES = { guitar: 'Guitar', piano: 'Piano', bass: 'Bass', vocals: 'Vocal melody', other: 'Other' };
const TAB_STRINGS = { guitar: GUITAR_STRINGS, bass: BASS_STRINGS };
const ROLL_HEIGHT = 170;
const ROLL_PADDING = 2;

function formatTime(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function createButton(label, onClick) {
  const button = document.createElement('button');

  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', onClick);

  return button;
}

export class NotesView {
  constructor({ getPosition, getDuration, getLoop, seekTo, playRange, findNotes, exportMidi, isBusy }) {
    this.getPosition = getPosition;
    this.getDuration = getDuration;
    this.getLoop = getLoop;
    this.seekTo = seekTo;
    this.playRange = playRange;
    this.findNotes = findNotes;
    this.exportMidi = exportMidi;
    this.isBusy = isBusy;

    this.notes = null;
    this.analysis = null;
    this.part = null;
    this.range = 'song';
    this.format = 'tab';
    this.visible = false;
    this.lastDrawn = null;

    this.missing = document.getElementById('notes-missing');
    this.missingText = document.getElementById('notes-missing-text');
    this.findButton = document.getElementById('notes-find');
    this.content = document.getElementById('notes-content');
    this.soloList = document.getElementById('solo-list');
    this.partSelect = document.getElementById('notes-part');
    this.rangeSelect = document.getElementById('notes-range');
    this.formatButtons = [...document.querySelectorAll('#notes-format button')];
    this.copyButton = document.getElementById('notes-copy');
    this.exportButton = document.getElementById('notes-export');
    this.againButton = document.getElementById('notes-again');
    this.noteText = document.getElementById('notes-note');
    this.canvas = document.getElementById('piano-roll');
    this.text = document.getElementById('notes-text');

    this.findButton.addEventListener('click', () => this.findNotes());
    this.againButton.addEventListener('click', () => this.findNotes());
    this.exportButton.addEventListener('click', () => this.exportMidi());

    this.partSelect.addEventListener('change', () => {
      this.part = this.partSelect.value;

      if (this.range.startsWith('solo:')) {
        this.range = 'song';
      }

      this.renderOutput();
    });

    this.rangeSelect.addEventListener('change', () => {
      this.range = this.rangeSelect.value;

      if (this.range.startsWith('solo:')) {
        this.part = this.solo().stem;
      }

      this.renderOutput();
    });

    for (const button of this.formatButtons) {
      button.addEventListener('click', () => {
        this.format = button.dataset.format;
        this.renderOutput();
      });
    }

    this.copyButton.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(this.text.textContent);
        this.copyButton.textContent = 'Copied';
      } catch {
        this.copyButton.textContent = 'Could Not Copy';
      }

      setTimeout(() => {
        this.copyButton.textContent = 'Copy';
      }, 1500);
    });

    this.canvas.addEventListener('click', (event) => {
      const { start, end } = this.span();
      const bounds = this.canvas.getBoundingClientRect();
      this.seekTo(start + ((event.clientX - bounds.left) / bounds.width) * (end - start));
    });

    new ResizeObserver(() => this.draw(true)).observe(this.canvas);
  }

  setAnalysis(analysis) {
    this.analysis = analysis;

    if (this.notes) {
      this.renderOutput();
    }
  }

  show(notes) {
    this.notes = notes;
    const parts = Object.keys(notes?.parts ?? {});

    if (!parts.includes(this.part)) {
      this.part = parts.includes('guitar') ? 'guitar' : parts[0] ?? null;
    }

    this.range = 'song';
    this.render();
  }

  showMissing() {
    this.notes = null;
    this.render();
  }

  setVisible(visible) {
    this.visible = visible;

    if (visible) {
      this.draw(true);
    }
  }

  refreshBusy() {
    this.render();
  }

  refreshLoop() {
    if (this.notes) {
      this.renderRangeOptions();

      if (this.range === 'loop') {
        this.renderOutput();
      }
    }
  }

  render() {
    const busy = this.isBusy();
    const hasNotes = Boolean(this.notes && Object.keys(this.notes.parts).length > 0);

    this.missing.hidden = hasNotes;
    this.content.hidden = !hasNotes;
    this.findButton.hidden = busy;
    this.againButton.disabled = busy;

    if (!hasNotes) {
      this.missingText.textContent = busy
        ? 'Writing out the notes...'
        : this.notes
          ? 'No notes could be written out for this song.'
          : 'The notes for this song have not been written out yet.';
      return;
    }

    this.renderSolos();
    this.partSelect.replaceChildren(
      ...Object.keys(this.notes.parts).map((part) => new Option(PART_NAMES[part] ?? part, part)),
    );
    this.renderOutput();
  }

  renderSolos() {
    const solos = this.notes.solos ?? [];

    if (solos.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'note';
      empty.textContent = 'No solos were found. You can still write out any part below, for the whole song or a section you loop.';
      this.soloList.replaceChildren(empty);
      return;
    }

    this.soloList.replaceChildren(...solos.map((solo, index) => {
      const row = document.createElement('div');
      row.className = 'solo-row';

      const label = document.createElement('span');
      label.textContent = `${solo.label}, ${formatTime(solo.start)} to ${formatTime(solo.end)}`;

      row.append(
        label,
        createButton('Show Notes', () => {
          this.range = `solo:${index}`;
          this.part = solo.stem;
          this.renderOutput();
        }),
        createButton('Listen', () => this.playRange(solo.start, solo.end)),
      );

      return row;
    }));
  }

  renderRangeOptions() {
    const loop = this.getLoop();
    const options = [new Option('Whole song', 'song')];
    const loopOption = new Option(loop ? `Looped section, ${formatTime(loop.start)} to ${formatTime(loop.end)}` : 'Looped section (drag across a waveform first)', 'loop');

    loopOption.disabled = !loop;
    options.push(loopOption);

    (this.notes.solos ?? []).forEach((solo, index) => {
      options.push(new Option(`${solo.label}, ${formatTime(solo.start)}`, `solo:${index}`));
    });

    if (this.range === 'loop' && !loop) {
      this.range = 'song';
    }

    this.rangeSelect.replaceChildren(...options);
    this.rangeSelect.value = this.range;
  }

  solo() {
    return this.notes.solos[Number(this.range.split(':')[1])];
  }

  span() {
    if (this.range === 'loop' && this.getLoop()) {
      return this.getLoop();
    }

    if (this.range.startsWith('solo:')) {
      const { start, end } = this.solo();
      return { start, end };
    }

    return { start: 0, end: this.getDuration() };
  }

  selectedNotes() {
    const { start, end } = this.span();
    const source = this.range.startsWith('solo:') ? this.solo().notes : this.notes.parts[this.part]?.notes ?? [];

    return source.filter((note) => note[1] > start && note[0] < end);
  }

  renderOutput() {
    this.renderRangeOptions();
    this.partSelect.value = this.part;

    const canTab = Boolean(TAB_STRINGS[this.part]);
    const format = canTab ? this.format : 'names';

    for (const button of this.formatButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.format === format));
      button.disabled = button.dataset.format === 'tab' && !canTab;
    }

    const { start, end } = this.span();
    const notes = this.selectedNotes();
    const options = {
      start,
      end,
      downbeats: this.analysis?.downbeats ?? [],
      beatsPerBar: this.analysis?.tempo?.beatsPerBar ?? 4,
    };

    if (notes.length === 0) {
      this.text.textContent = 'No notes in this part here.';
    } else if (format === 'tab') {
      this.text.textContent = buildTab(notes, { ...options, strings: TAB_STRINGS[this.part] });
    } else {
      this.text.textContent = buildNoteNames(notes, options);
    }

    const solo = this.range.startsWith('solo:');
    this.noteText.textContent = solo
      ? 'Showing the lead line only, one note at a time. Check by ear, since some notes can be missed or misheard.'
      : 'Written out automatically from the separated part, so expect some wrong or missing notes, especially in busy passages.';

    this.draw(true);
  }

  update(seconds) {
    if (this.visible && this.notes && seconds !== this.lastDrawn) {
      this.draw(false);
    }
  }

  draw(force) {
    if (!this.visible || !this.notes || this.content.hidden) {
      return;
    }

    const position = this.getPosition();

    if (!force && position === this.lastDrawn) {
      return;
    }

    this.lastDrawn = position;

    const canvas = this.canvas;
    const width = Math.round(canvas.clientWidth * devicePixelRatio);
    const height = Math.round(ROLL_HEIGHT * devicePixelRatio);

    if (width === 0) {
      return;
    }

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const context = canvas.getContext('2d');
    const style = getComputedStyle(canvas);
    const { start, end } = this.span();
    const notes = this.selectedNotes();
    const pitches = notes.map((note) => note[2]);
    const low = (pitches.length ? Math.min(...pitches) : 60) - ROLL_PADDING;
    const high = (pitches.length ? Math.max(...pitches) : 72) + ROLL_PADDING;
    const rowHeight = height / (high - low + 1);
    const xOf = (seconds) => ((seconds - start) / (end - start)) * width;
    const yOf = (pitch) => (high - pitch) * rowHeight;

    context.clearRect(0, 0, width, height);
    context.font = `${10 * devicePixelRatio}px system-ui`;

    for (let pitch = low; pitch <= high; pitch++) {
      if (pitch % 12 === 0) {
        context.fillStyle = style.getPropertyValue('--roll-line');
        context.fillRect(0, yOf(pitch) + rowHeight - 1, width, 1);
        context.fillStyle = style.color;
        context.fillText(noteLabel(pitch), 2, yOf(pitch) + rowHeight - 2);
      }
    }

    context.fillStyle = style.getPropertyValue('--roll-note');

    for (const note of notes) {
      const x = xOf(note[0]);
      context.fillRect(x, yOf(note[2]) + 1, Math.max(2, xOf(note[1]) - x), Math.max(2, rowHeight - 2));
    }

    if (position >= start && position <= end) {
      context.fillStyle = style.color;
      context.fillRect(xOf(position), 0, Math.max(1, devicePixelRatio), height);
    }
  }
}
