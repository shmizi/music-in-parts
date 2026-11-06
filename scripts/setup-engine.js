const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pythonPath, venvDir, dataRoot, modelsDir, chordModelPath } = require('../app/paths');

const TORCH_INDEX = 'https://download.pytorch.org/whl/cu130';
const REQUIREMENTS = path.join(__dirname, '..', 'engine', 'requirements.txt');
const CHORD_MODEL_URL = 'https://raw.githubusercontent.com/jayg996/BTC-ISMIR19/2682317be668032e6e4b269ded36adaa2ad57df0/test/btc_model_large_voca.pt';
const CHORD_MODEL_SHA256 = '1673d23f8f9a55ae7f9e8b80a51da616debb22675b8d8b67ea6ce0ef37b0ab51';

function run(command, args) {
  console.log(`\n> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { stdio: 'inherit' });

  if (result.status !== 0) {
    console.error(`\nSetup failed while running: ${command}`);
    process.exit(result.status ?? 1);
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function downloadChordModel() {
  if (fs.existsSync(chordModelPath) && sha256(fs.readFileSync(chordModelPath)) === CHORD_MODEL_SHA256) {
    return;
  }

  console.log('\nDownloading the chord model');
  const response = await fetch(CHORD_MODEL_URL);

  if (!response.ok) {
    throw new Error(`Chord model download failed with status ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());

  if (sha256(bytes) !== CHORD_MODEL_SHA256) {
    throw new Error('The downloaded chord model did not match its expected checksum');
  }

  fs.mkdirSync(modelsDir, { recursive: true });
  fs.writeFileSync(chordModelPath, bytes);
}

fs.mkdirSync(dataRoot, { recursive: true });

if (!fs.existsSync(pythonPath)) {
  run('py', ['-3.11', '-m', 'venv', venvDir]);
}

run(pythonPath, ['-m', 'pip', 'install', '--upgrade', 'pip']);
run(pythonPath, ['-m', 'pip', 'install', 'torch', 'torchaudio', '--index-url', TORCH_INDEX]);
run(pythonPath, ['-m', 'pip', 'install', '-r', REQUIREMENTS]);

downloadChordModel()
  .then(() => console.log('\nEngine is ready.'))
  .catch((error) => {
    console.error(`\nSetup failed: ${error.message}`);
    process.exit(1);
  });
