import {
  buildChart,
  currentAndNextChord,
  displayChord,
  findIndexAt,
  isChordDoubtful,
  mergeChordWithPrevious,
  mergeSectionWithPrevious,
  renameChord,
  renameSection,
  setKeyName,
  setTempo,
  splitChord,
  splitSection,
} from './chart.mjs';

const KEY_UNSURE_BELOW = 0.5;

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

export class AnalysisView {
  constructor({ getPosition, getSong, seekTo, loopSection, onEdited }) {
    this.getPosition = getPosition;
    this.getSong = getSong;
    this.seekTo = seekTo;
    this.loopSection = loopSection;
    this.onEdited = onEdited;

    this.analysis = null;
    this.selection = null;
    this.barCells = [];
    this.activeBarCell = null;
    this.activeChordLabel = null;
    this.activeNextLabel = null;

    this.info = document.getElementById('song-info');
    this.keyInput = document.getElementById('key-input');
    this.keyNote = document.getElementById('key-note');
    this.tempoInput = document.getElementById('tempo-input');
    this.tempoNote = document.getElementById('tempo-note');
    this.revertButton = document.getElementById('revert-analysis');
    this.nowChord = document.getElementById('now-chord');
    this.nextChord = document.getElementById('next-chord');
    this.warning = document.getElementById('chord-warning');
    this.lanes = document.getElementById('lanes');
    this.sectionLane = document.getElementById('section-lane');
    this.chordLane = document.getElementById('chord-lane');
    this.inspector = document.getElementById('inspector');
    this.chart = document.getElementById('chart');
    this.chartMessage = document.getElementById('chart-message');
    this.chartMessageText = document.getElementById('chart-message-text');
    this.analyseButton = document.getElementById('analyse-song');

    this.keyInput.addEventListener('change', () => {
      const name = this.keyInput.value.trim();

      if (name) {
        this.applyEdit(setKeyName(this.analysis, name));
      } else {
        this.render();
      }
    });

    this.tempoInput.addEventListener('change', () => {
      const bpm = Number(this.tempoInput.value);

      if (bpm > 0) {
        this.applyEdit(setTempo(this.analysis, bpm));
      } else {
        this.render();
      }
    });
  }

  showMissing({ analysing }) {
    this.analysis = null;
    this.selection = null;
    this.info.hidden = true;
    this.warning.hidden = true;
    this.lanes.hidden = true;
    this.inspector.hidden = true;
    this.chart.replaceChildren();
    this.chartMessage.hidden = false;
    this.chartMessageText.textContent = analysing
      ? 'Finding the key, tempo, chords and sections...'
      : 'This song has not been analysed yet.';
    this.analyseButton.hidden = analysing;
  }

  show(analysis, edited) {
    this.analysis = analysis;
    this.edited = edited;
    this.selection = null;
    this.chartMessage.hidden = true;
    this.info.hidden = false;
    this.lanes.hidden = false;
    this.render();
  }

  applyEdit(analysis) {
    this.analysis = analysis;
    this.edited = true;
    this.render();
    this.onEdited(analysis);
  }

  render() {
    this.renderInfo();
    this.renderLane(this.sectionLane, this.analysis.sections, 'section', (section) => section.label);
    this.renderLane(this.chordLane, this.analysis.chords, 'chord', (chord) => displayChord(chord.label));
    this.renderChart();
    this.renderInspector();
    this.activeBarCell = null;
    this.activeChordLabel = null;
    this.activeNextLabel = null;
    this.update(this.getPosition(), false);
  }

  renderInfo() {
    const { key, tempo, mainNotes, chordsReliable } = this.analysis;

    this.keyInput.value = key.name;
    this.keyNote.textContent = !key.edited && key.confidence < KEY_UNSURE_BELOW
      ? `(unsure, could be ${key.alternative})`
      : '';

    this.tempoInput.value = tempo.bpm ?? '';
    this.tempoNote.textContent = this.describeTempo(tempo);

    this.revertButton.hidden = !this.edited;

    this.warning.hidden = chordsReliable;
    this.warning.textContent = `The chords look unreliable for this song, so check them by ear. Its main notes are ${mainNotes.join(', ')}.`;
  }

  describeTempo(tempo) {
    const parts = [];

    if (tempo.beatsPerBar) {
      parts.push(`${tempo.beatsPerBar} beats per bar`);
    }

    if (tempo.bpm === null) {
      parts.push('no steady beat found');
    } else if (!tempo.edited && !tempo.steady) {
      parts.push('the tempo drifts');
    }

    return parts.join(', ');
  }

  renderLane(lane, items, kind, labelOf) {
    const duration = this.getSong().duration;

    lane.replaceChildren(
      ...items.map((item, index) => {
        const block = document.createElement('button');
        const label = labelOf(item);

        block.type = 'button';
        block.className = 'lane-block';
        block.textContent = label;
        block.title = `${label} at ${formatTime(item.start)}`;
        block.style.left = `${(item.start / duration) * 100}%`;
        block.style.width = `${((item.end - item.start) / duration) * 100}%`;
        block.classList.toggle('doubtful', kind === 'chord' && isChordDoubtful(this.analysis, item));
        block.classList.toggle('selected', this.selection?.kind === kind && this.selection.index === index);
        block.addEventListener('click', () => this.select(kind, index, item.start));

        return block;
      }),
    );
  }

  renderChart() {
    this.barCells = [];

    const sections = buildChart(this.analysis).map((section) => {
      const element = document.createElement('section');
      element.className = 'chart-section';

      const heading = document.createElement('button');
      heading.type = 'button';
      heading.className = 'chart-heading';
      heading.textContent = `${section.label}  ${formatTime(section.start)}`;
      heading.addEventListener('click', () => this.select('section', section.sectionIndex, section.start));

      const bars = document.createElement('div');
      bars.className = 'chart-bars';

      for (const bar of section.bars) {
        bars.append(this.createBarCell(bar));
      }

      element.append(heading, bars);
      return element;
    });

    this.chart.replaceChildren(...sections);
  }

  createBarCell(bar) {
    const cell = document.createElement('div');
    cell.className = 'chart-bar';

    for (const chord of bar.chords) {
      const button = document.createElement('button');

      button.type = 'button';
      button.className = 'chart-chord';
      button.textContent = chord.doubtful ? `${chord.label}?` : chord.label;
      button.classList.toggle('doubtful', chord.doubtful);
      button.addEventListener('click', () => {
        const start = Math.max(bar.start, this.analysis.chords[chord.chordIndex].start);
        this.select('chord', chord.chordIndex, start);
      });

      cell.append(button);
    }

    this.barCells.push({ cell, start: bar.start, end: bar.end });

    return cell;
  }

  select(kind, index, seconds) {
    this.selection = { kind, index };
    this.seekTo(seconds);
    this.render();
  }

  clearSelection() {
    this.selection = null;
    this.render();
  }

  renderInspector() {
    this.inspector.hidden = this.selection === null;
    this.inspector.replaceChildren();

    if (this.selection === null) {
      return;
    }

    if (this.selection.kind === 'chord') {
      this.renderChordInspector(this.selection.index);
    } else {
      this.renderSectionInspector(this.selection.index);
    }
  }

  createLabelEditor(caption, value, onSave) {
    const label = document.createElement('label');
    const input = document.createElement('input');

    input.type = 'text';
    input.value = value;
    input.addEventListener('change', () => {
      const text = input.value.trim();

      if (text) {
        onSave(text);
      }
    });

    label.append(`${caption} `, input);
    return label;
  }

  renderChordInspector(index) {
    const chord = this.analysis.chords[index];

    if (!chord) {
      this.clearSelection();
      return;
    }

    const editor = this.createLabelEditor('Chord', chord.label === 'N' ? '' : chord.label, (text) => {
      this.selection = null;
      this.applyEdit(renameChord(this.analysis, index, text));
    });

    const split = createButton('Split at Playhead', () => {
      this.selection = null;
      this.applyEdit(splitChord(this.analysis, index, this.getPosition()));
    });

    const merge = createButton('Merge with Previous', () => {
      this.selection = null;
      this.applyEdit(mergeChordWithPrevious(this.analysis, index));
    });

    merge.disabled = index === 0;

    this.inspector.append(editor, split, merge, createButton('Close', () => this.clearSelection()));
  }

  renderSectionInspector(index) {
    const section = this.analysis.sections[index];

    if (!section) {
      this.clearSelection();
      return;
    }

    const editor = this.createLabelEditor('Section', section.label, (text) => {
      this.selection = null;
      this.applyEdit(renameSection(this.analysis, index, text));
    });

    const loop = createButton('Loop This Section', () => this.loopSection(section.start, section.end));

    const split = createButton('Split at Playhead', () => {
      this.selection = null;
      this.applyEdit(splitSection(this.analysis, index, this.getPosition()));
    });

    const merge = createButton('Merge with Previous', () => {
      this.selection = null;
      this.applyEdit(mergeSectionWithPrevious(this.analysis, index));
    });

    merge.disabled = index === 0;

    this.inspector.append(editor, loop, split, merge, createButton('Close', () => this.clearSelection()));
  }

  update(seconds, followPlayback) {
    if (!this.analysis) {
      return;
    }

    const { current, next } = currentAndNextChord(this.analysis.chords, seconds);
    const nowLabel = current ? displayChord(current.label) : '-';
    const nextLabel = next ? displayChord(next.label) : '-';

    if (nowLabel !== this.activeChordLabel) {
      this.nowChord.textContent = nowLabel;
      this.activeChordLabel = nowLabel;
    }

    if (nextLabel !== this.activeNextLabel) {
      this.nextChord.textContent = nextLabel;
      this.activeNextLabel = nextLabel;
    }

    const barIndex = findIndexAt(this.barCells, seconds);
    const cell = barIndex >= 0 ? this.barCells[barIndex].cell : null;

    if (cell !== this.activeBarCell) {
      this.activeBarCell?.classList.remove('current');
      cell?.classList.add('current');
      this.activeBarCell = cell;

      if (cell && followPlayback) {
        cell.scrollIntoView({ block: 'nearest' });
      }
    }
  }
}
