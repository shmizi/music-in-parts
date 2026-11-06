# Music in Parts

A personal desktop app for learning and arranging song covers. Add a song and it splits into vocals, drums, bass, guitar, piano and other. You can then mute, solo, loop or slow down any part while you play along, and export the stems as WAV files.

Everything runs on your own computer.

## Setup

You need Node.js and Python 3.11. An NVIDIA graphics card is strongly recommended, since the CPU is much slower.

```
npm install
npm run setup
```

`npm run setup` installs the audio engine into `%LOCALAPPDATA%\MusicInParts`, which is kept out of the project folder so OneDrive doesn't sync several gigabytes of libraries.

## Running

```
npm start
```

To add a desktop shortcut:

```
npm run shortcut
```

## Where things live

- `app/` is the Electron app: `main.js` for the window and file access, `jobs.js` for the separation queue, `renderer/` for the interface and mixer.
- `engine/separate.py` decodes a song and runs the Demucs `htdemucs_6s` model.
- Songs and the downloaded model are stored in `%LOCALAPPDATA%\MusicInParts`.

## Tests

```
npm test
```
