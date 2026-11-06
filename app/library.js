const fs = require('node:fs/promises');
const path = require('node:path');
const { libraryDir } = require('./paths');

const SONG_ID = /^[0-9a-f-]{36}$/;
const STEM_NAME = /^[a-z]+$/;
const TEMP_SUFFIX = '.tmp';

function songDir(id) {
  if (!SONG_ID.test(id)) {
    throw new Error('Invalid song id');
  }

  return path.join(libraryDir, id);
}

function tempDir(id) {
  return songDir(id) + TEMP_SUFFIX;
}

function stemPath(id, stem) {
  if (!STEM_NAME.test(stem)) {
    throw new Error('Invalid stem name');
  }

  return path.join(songDir(id), 'stems', `${stem}.wav`);
}

async function removeUnfinished() {
  await fs.mkdir(libraryDir, { recursive: true });
  const entries = await fs.readdir(libraryDir);

  for (const entry of entries) {
    if (entry.endsWith(TEMP_SUFFIX)) {
      await fs.rm(path.join(libraryDir, entry), { recursive: true, force: true });
    }
  }
}

async function listSongs() {
  await fs.mkdir(libraryDir, { recursive: true });
  const entries = await fs.readdir(libraryDir);
  const songs = [];

  for (const entry of entries) {
    if (!SONG_ID.test(entry)) {
      continue;
    }

    try {
      const text = await fs.readFile(path.join(libraryDir, entry, 'song.json'), 'utf8');
      songs.push(JSON.parse(text));
    } catch {
      continue;
    }
  }

  return songs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function finishSong(id, song) {
  const temp = tempDir(id);
  await fs.writeFile(path.join(temp, 'song.json'), JSON.stringify(song, null, 2));
  await fs.rename(temp, songDir(id));
}

async function deleteSong(id) {
  await fs.rm(songDir(id), { recursive: true, force: true });
}

async function deleteTemp(id) {
  await fs.rm(tempDir(id), { recursive: true, force: true });
}

async function readStem(id, stem) {
  return fs.readFile(stemPath(id, stem));
}

async function readSong(id) {
  const text = await fs.readFile(path.join(songDir(id), 'song.json'), 'utf8');
  return JSON.parse(text);
}

function safeFileName(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
}

async function exportStems(id, targetDir) {
  const song = await readSong(id);

  for (const stem of song.stems) {
    const target = path.join(targetDir, `${safeFileName(song.title)} - ${stem}.wav`);
    await fs.copyFile(stemPath(id, stem), target);
  }

  return song.stems.length;
}

module.exports = {
  tempDir,
  removeUnfinished,
  listSongs,
  finishSong,
  deleteSong,
  deleteTemp,
  readStem,
  readSong,
  exportStems,
};
