# Music in Parts

A personal desktop app for learning and arranging song covers. Add a song and it splits into vocals, drums, bass, guitar, piano and other, then works out the key, tempo, chords and sections.

- **Practise:** mute, solo, loop or slow down any part while you play along, following the current and next chord.
- **Read:** a chord chart shows every bar, grouped by section, and follows the song as it plays.
- **Check:** Chord Check compares every copy of a chord, flags names that don't match what it hears, and lets you step through and play each copy.
- **Correct:** click any chord or section to rename, split or merge it, or change every copy at once. Your changes are saved with the song and can be reverted.
- **Export:** save the stems as WAV files.

Everything runs on your own computer.

## Setup

You need Node.js and Python 3.11. An NVIDIA graphics card is strongly recommended, since the CPU is much slower.

```
npm install
npm run setup
```

`npm run setup` installs the audio engine into `%LOCALAPPDATA%\MusicInParts`, which is kept out of the project folder so OneDrive doesn't sync several gigabytes of libraries. Run it again whenever `engine/requirements.txt` changes.

## Running

```
npm start
```

To add a desktop shortcut:

```
npm run shortcut
```

## Where things live

- `app/` is the Electron app: `main.js` for the window and file access, `jobs.js` for the processing queue, `renderer/` for the interface, mixer and chord chart.
- `engine/separate.py` decodes a song and splits it with the Demucs `htdemucs_6s` model.
- `engine/analyse.py` finds the beat with Beat This!, the chords with BTC, and the key and sections with signal analysis. The section names are guesses.
- `engine/evidence.py` records how strong each note is on every beat, and `app/renderer/chord-check.mjs` compares chords using those levels.
- `engine/btc/` is the BTC model code from [BTC-ISMIR19](https://github.com/jayg996/BTC-ISMIR19), under its own MIT licence.
- Songs and the downloaded models are stored in `%LOCALAPPDATA%\MusicInParts`.

## Tests

```
npm test
```

```
npm run test:engine
```
