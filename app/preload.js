const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listSongs: () => ipcRenderer.invoke('list-songs'),
  listJobs: () => ipcRenderer.invoke('list-jobs'),
  chooseSongs: () => ipcRenderer.invoke('choose-songs'),
  addPaths: (paths) => ipcRenderer.invoke('add-paths', paths),
  cancelJob: (jobId) => ipcRenderer.invoke('cancel-job', jobId),
  readStem: (songId, stem) => ipcRenderer.invoke('read-stem', songId, stem),
  exportStems: (songId) => ipcRenderer.invoke('export-stems', songId),
  deleteSong: (songId) => ipcRenderer.invoke('delete-song', songId),
  pathForFile: (file) => webUtils.getPathForFile(file),
  onJobsChanged: (callback) => ipcRenderer.on('jobs-changed', (_, jobs) => callback(jobs)),
  onSongFinished: (callback) => ipcRenderer.on('song-finished', (_, songId) => callback(songId)),
});
