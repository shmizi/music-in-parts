const path = require('node:path');

const dataRoot = path.join(process.env.LOCALAPPDATA, 'MusicInParts');
const venvDir = path.join(dataRoot, 'venv');
const pythonPath = path.join(venvDir, 'Scripts', 'python.exe');
const sitePackagesDir = path.join(venvDir, 'Lib', 'site-packages');
const modelsDir = path.join(dataRoot, 'models');
const chordModelPath = path.join(modelsDir, 'btc_model_large_voca.pt');
const libraryDir = path.join(dataRoot, 'library');
const separateScript = path.join(__dirname, '..', 'engine', 'separate.py');
const analyseScript = path.join(__dirname, '..', 'engine', 'analyse.py');

module.exports = {
  dataRoot,
  venvDir,
  pythonPath,
  sitePackagesDir,
  modelsDir,
  chordModelPath,
  libraryDir,
  separateScript,
  analyseScript,
};
