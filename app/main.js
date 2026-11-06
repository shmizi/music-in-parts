const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('node:path');
const library = require('./library');
const { JobQueue } = require('./jobs');

const AUDIO_EXTENSIONS = [
  'mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'wma', 'aif', 'aiff', 'mp4', 'mkv', 'webm', 'mov',
];

let mainWindow = null;

const queue = new JobQueue({
  onChange: () => send('jobs-changed', queue.list()),
  onSongFinished: (songId) => send('song-finished', songId),
  onAnalysisFinished: (songId) => send('analysis-finished', songId),
});

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

async function chooseSongs() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Add songs',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Audio and video', extensions: AUDIO_EXTENSIONS },
      { name: 'All files', extensions: ['*'] },
    ],
  });

  if (!result.canceled) {
    result.filePaths.forEach((filePath) => queue.addSong(filePath));
  }
}

async function exportStems(songId) {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a folder for the stems',
    properties: ['openDirectory', 'createDirectory'],
  });

  if (result.canceled) {
    return null;
  }

  const count = await library.exportStems(songId, result.filePaths[0]);
  return { count, folder: result.filePaths[0] };
}

async function deleteSong(songId) {
  const song = await library.readSong(songId);

  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Delete', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: `Delete "${song.title}" from the library?`,
    detail: 'This removes its stems from the app. Your original file is not touched.',
  });

  if (response !== 0) {
    return false;
  }

  queue.cancelForSong(songId);
  await library.deleteSong(songId);
  return true;
}

async function analyseSong(songId) {
  const song = await library.readSong(songId);
  queue.addAnalysis(songId, song.title);
}

async function revertAnalysis(songId) {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Discard My Changes', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: 'Go back to the automatic analysis?',
    detail: 'Your changes to the chords, sections, key and tempo for this song will be lost.',
  });

  if (response !== 0) {
    return false;
  }

  await library.revertAnalysis(songId);
  return true;
}

function registerHandlers() {
  ipcMain.handle('list-songs', () => library.listSongs());
  ipcMain.handle('list-jobs', () => queue.list());
  ipcMain.handle('choose-songs', () => chooseSongs());
  ipcMain.handle('add-paths', (_, paths) => paths.forEach((filePath) => queue.addSong(filePath)));
  ipcMain.handle('cancel-job', (_, jobId) => queue.cancel(jobId));
  ipcMain.handle('read-stem', (_, songId, stem) => library.readStem(songId, stem));
  ipcMain.handle('export-stems', (_, songId) => exportStems(songId));
  ipcMain.handle('delete-song', (_, songId) => deleteSong(songId));
  ipcMain.handle('analyse-song', (_, songId) => analyseSong(songId));
  ipcMain.handle('read-analysis', (_, songId) => library.readAnalysis(songId));
  ipcMain.handle('save-analysis', (_, songId, analysis) => library.saveEditedAnalysis(songId, analysis));
  ipcMain.handle('revert-analysis', (_, songId) => revertAnalysis(songId));
}

function buildMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: 'Add Songs...', accelerator: 'CmdOrCtrl+O', click: chooseSongs },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
      ],
    },
  ]);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 800,
    minHeight: 640,
    title: 'Music in Parts',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(async () => {
  await library.removeUnfinished();
  registerHandlers();
  Menu.setApplicationMenu(buildMenu());
  createWindow();
});

app.on('window-all-closed', () => {
  queue.stopAll();
  app.quit();
});
