const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pythonPath, venvDir, dataRoot } = require('../app/paths');

const TORCH_INDEX = 'https://download.pytorch.org/whl/cu130';
const REQUIREMENTS = path.join(__dirname, '..', 'engine', 'requirements.txt');

function run(command, args) {
  console.log(`\n> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { stdio: 'inherit' });

  if (result.status !== 0) {
    console.error(`\nSetup failed while running: ${command}`);
    process.exit(result.status ?? 1);
  }
}

fs.mkdirSync(dataRoot, { recursive: true });

if (!fs.existsSync(pythonPath)) {
  run('py', ['-3.11', '-m', 'venv', venvDir]);
}

run(pythonPath, ['-m', 'pip', 'install', '--upgrade', 'pip']);
run(pythonPath, ['-m', 'pip', 'install', 'torch', 'torchaudio', '--index-url', TORCH_INDEX]);
run(pythonPath, ['-m', 'pip', 'install', '-r', REQUIREMENTS]);

console.log('\nEngine is ready.');
