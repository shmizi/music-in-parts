const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { pythonPath } = require('../app/paths');

const result = spawnSync(pythonPath, ['-m', 'unittest', 'test_analysis'], {
  cwd: path.join(__dirname, '..', 'engine'),
  stdio: 'inherit',
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
});

process.exit(result.status ?? 1);
