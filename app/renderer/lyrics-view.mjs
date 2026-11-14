import {
  LANGUAGES,
  buildLyricSheet,
  describeLanguage,
  findWordAt,
  lyricsAsText,
} from './lyric-sheet.mjs';

function createButton(label, onClick) {
  const button = document.createElement('button');

  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', onClick);

  return button;
}

export class LyricsView {
  constructor({ getPosition, seekTo, selectChord, transcribe, paste, revert, isBusy }) {
    this.getPosition = getPosition;
    this.seekTo = seekTo;
    this.selectChord = selectChord;
    this.transcribe = transcribe;
    this.paste = paste;
    this.revert = revert;
    this.isBusy = isBusy;

    this.lyrics = null;
    this.edited = false;
    this.analysis = null;
    this.showRomanized = true;
    this.lineElements = [];
    this.activeWord = null;
    this.activeLine = null;

    this.area = document.getElementById('chord-area');
    this.inspector = document.getElementById('inspector');
    this.languageNote = document.getElementById('lyrics-language-note');
    this.languageSelect = document.getElementById('lyrics-language');
    this.transcribeButton = document.getElementById('lyrics-transcribe');
    this.romanizedToggle = document.getElementById('lyrics-romanized-toggle');
    this.romanizedBox = document.getElementById('lyrics-romanized');
    this.editButton = document.getElementById('lyrics-edit');
    this.revertButton = document.getElementById('lyrics-revert');
    this.message = document.getElementById('lyrics-message');
    this.editor = document.getElementById('lyrics-editor');
    this.textBox = document.getElementById('lyrics-text');
    this.sheet = document.getElementById('lyric-sheet');

    this.languageSelect.replaceChildren(
      ...LANGUAGES.map(([code, name]) => new Option(name, code)),
    );

    this.transcribeButton.addEventListener('click', () => this.transcribe(this.languageSelect.value));

    this.romanizedBox.addEventListener('change', () => {
      this.showRomanized = this.romanizedBox.checked;
      this.renderSheet();
    });

    this.editButton.addEventListener('click', () => this.openEditor());
    this.revertButton.addEventListener('click', () => this.revert());
    document.getElementById('lyrics-cancel').addEventListener('click', () => this.closeEditor());

    document.getElementById('lyrics-save').addEventListener('click', () => {
      const text = this.textBox.value.trim();

      if (text) {
        this.paste(text);
        this.closeEditor();
      }
    });
  }

  showMissing() {
    this.lyrics = null;
    this.edited = false;
    this.closeEditor();
    this.render();
  }

  show(lyrics, edited) {
    this.lyrics = lyrics;
    this.edited = edited;
    this.render();
  }

  setAnalysis(analysis) {
    this.analysis = analysis;

    if (this.lyrics) {
      this.renderSheet();
    }
  }

  refreshBusy() {
    this.renderToolbar();
  }

  openEditor() {
    this.textBox.value = this.lyrics ? lyricsAsText(this.lyrics) : '';
    this.editor.hidden = false;
    this.textBox.focus();
  }

  closeEditor() {
    this.editor.hidden = true;
  }

  render() {
    this.renderToolbar();
    this.renderSheet();
  }

  renderToolbar() {
    const busy = this.isBusy();
    const lyrics = this.lyrics;
    const hasLines = Boolean(lyrics?.lines.length);
    const hasRomanized = Boolean(lyrics?.lines.some((line) => line.romanized));

    this.languageSelect.value = lyrics?.language && LANGUAGES.some(([code]) => code === lyrics.language)
      ? lyrics.language
      : 'auto';

    this.transcribeButton.textContent = lyrics ? 'Transcribe Again' : 'Find Lyrics';
    this.transcribeButton.disabled = busy;
    this.editButton.disabled = busy || !lyrics || !hasLines;
    this.revertButton.hidden = !this.edited;
    this.revertButton.disabled = busy;
    this.romanizedToggle.hidden = !hasRomanized;
    this.romanizedBox.checked = this.showRomanized;
    this.languageNote.textContent = lyrics ? describeLanguage(lyrics) : '';

    if (busy) {
      this.message.textContent = 'Writing out the lyrics...';
    } else if (!lyrics) {
      this.message.textContent = 'This song has no lyrics yet. Choose its language if you know it, then Find Lyrics.';
    } else if (!hasLines) {
      this.message.textContent = 'No singing was found in this song.';
    } else if (lyrics.source === 'pasted') {
      this.message.textContent = 'Your lyrics, lined up with the singing. Grey words had to be placed by estimate.';
    } else {
      this.message.textContent = 'Written out automatically, so check it by ear. Grey words are the least certain. Edit Lyrics to paste the real ones.';
    }
  }

  renderSheet() {
    this.lineElements = [];
    this.activeWord = null;
    this.activeLine = null;

    if (!this.lyrics || this.lyrics.lines.length === 0) {
      this.sheet.replaceChildren();
      return;
    }

    this.sheet.lang = this.lyrics.language ?? '';

    const items = buildLyricSheet(this.lyrics, this.analysis);

    this.sheet.replaceChildren(...items.map((item) => {
      if (item.type === 'heading') {
        const heading = document.createElement('h3');
        heading.className = 'lyric-heading';
        heading.textContent = item.label;
        return heading;
      }

      if (item.type === 'instrumental') {
        return this.createInstrumental(item);
      }

      if (item.type === 'unheard') {
        return this.createUnheard(item);
      }

      return this.createLine(item);
    }));

    this.update(this.getPosition(), false);
  }

  createChordLabels(chords) {
    const holder = document.createElement('span');
    holder.className = 'lyric-chords';

    for (const chord of chords) {
      holder.append(createButton(chord.label, (event) => {
        event.stopPropagation();
        this.selectChord(chord.index);
      }));
    }

    return holder;
  }

  createInstrumental(item) {
    const row = document.createElement('div');
    row.className = 'lyric-instrumental';

    const label = document.createElement('span');
    label.textContent = 'Instrumental';
    label.className = 'note';

    row.append(label, this.createChordLabels(item.chords));
    return row;
  }

  createUnheard(item) {
    const row = document.createElement('div');
    row.className = 'lyric-instrumental';

    const label = document.createElement('span');
    label.textContent = "Singing here that couldn't be written out";
    label.className = 'note';

    row.append(label, createButton('Listen', () => this.seekTo(item.start)));
    return row;
  }

  createLine(item) {
    const line = document.createElement('div');
    line.className = 'lyric-line';

    const words = document.createElement('div');
    words.className = 'lyric-words';

    const wordElements = item.tokens.map((token) => {
      const element = document.createElement('span');
      element.className = 'lyric-token';
      element.classList.toggle('spaced', token.spaced);
      element.classList.toggle('doubtful', token.doubtful);

      const text = document.createElement('span');
      text.className = 'lyric-word';
      text.textContent = token.text;

      element.append(this.createChordLabels(token.chords), text);
      element.addEventListener('click', () => this.seekTo(token.start));

      words.append(element);
      return element;
    });

    line.append(words);

    if (item.romanized && this.showRomanized) {
      const romanized = document.createElement('div');
      romanized.className = 'lyric-romanized';
      romanized.textContent = item.romanized;
      line.append(romanized);
    }

    this.lineElements[item.lineIndex] = { line, words: wordElements };
    return line;
  }

  update(seconds, followPlayback) {
    if (!this.lyrics || this.lineElements.length === 0) {
      return;
    }

    const found = findWordAt(this.lyrics, seconds);
    const entry = found ? this.lineElements[found.lineIndex] : null;
    const line = entry?.line ?? null;
    const word = entry?.words[found.wordIndex] ?? null;

    if (line !== this.activeLine) {
      this.activeLine?.classList.remove('current');
      line?.classList.add('current');
      this.activeLine = line;

      if (line && followPlayback) {
        this.keepInView(line);
      }
    }

    if (word !== this.activeWord) {
      this.activeWord?.classList.remove('current');
      word?.classList.add('current');
      this.activeWord = word;
    }
  }

  keepInView(element) {
    const area = this.area.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    const pinned = getComputedStyle(this.inspector).position === 'sticky';
    const covered = pinned && !this.inspector.hidden ? this.inspector.offsetHeight : 0;

    if (box.top < area.top + covered) {
      this.area.scrollTop -= area.top + covered - box.top;
    } else if (box.bottom > area.bottom) {
      this.area.scrollTop += box.bottom - area.bottom;
    }
  }
}
