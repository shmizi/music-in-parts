const path = require('node:path');

const dataRoot = path.join(process.env.LOCALAPPDATA, 'MusicInParts');
const venvDir = path.join(dataRoot, 'venv');
const pythonPath = path.join(venvDir, 'Scripts', 'python.exe');
const modelsDir = path.join(dataRoot, 'models');
const libraryDir = path.join(dataRoot, 'library');
const separateScript = path.join(__dirname, '..', 'engine', 'separate.py');

module.exports = {
  dataRoot,
  venvDir,
  pythonPath,
  modelsDir,
  libraryDir,
  separateScript,
};
