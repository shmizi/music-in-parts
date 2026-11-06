const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { pythonPath, sitePackagesDir, modelsDir, separateScript } = require('./paths');
const library = require('./library');

const STDERR_LINES_KEPT = 20;
const ENGINE_PACKAGES = ['torch', 'demucs', 'imageio_ffmpeg', 'soundfile.py'];

class JobQueue {
  constructor(onChange, onSongFinished) {
    this.onChange = onChange;
    this.onSongFinished = onSongFinished;
    this.jobs = [];
    this.child = null;
  }

  list() {
    return this.jobs.map(({ id, title, status, stage, fraction, device, error }) => ({
      id,
      title,
      status,
      stage,
      fraction,
      device,
      error,
    }));
  }

  add(inputPath) {
    this.jobs.push({
      id: randomUUID(),
      title: path.parse(inputPath).name,
      inputPath,
      status: 'queued',
      stage: null,
      fraction: 0,
      device: null,
      error: null,
    });

    this.onChange();
    this.runNext();
  }

  cancel(id) {
    const job = this.jobs.find((candidate) => candidate.id === id);

    if (!job) {
      return;
    }

    if (job.status === 'running') {
      job.cancelled = true;
      this.child?.kill();
      return;
    }

    this.dismiss(id);
  }

  dismiss(id) {
    this.jobs = this.jobs.filter((job) => job.id !== id);
    this.onChange();
  }

  stopAll() {
    this.jobs = [];
    this.child?.kill();
  }

  runNext() {
    if (this.jobs.some((job) => job.status === 'running')) {
      return;
    }

    const job = this.jobs.find((candidate) => candidate.status === 'queued');

    if (job) {
      this.start(job);
    }
  }

  start(job) {
    job.status = 'running';
    this.onChange();

    if (!isEngineReady()) {
      this.fail(job, 'The audio engine is not fully installed. Run "npm run setup" in the project folder, wait for "Engine is ready", then add the song again.');
      return;
    }

    const child = spawn(
      pythonPath,
      [separateScript, '--input', job.inputPath, '--output', library.tempDir(job.id)],
      {
        windowsHide: true,
        env: {
          ...process.env,
          TORCH_HOME: modelsDir,
          PYTHONUNBUFFERED: '1',
          PYTHONUTF8: '1',
        },
      },
    );

    this.child = child;
    const stderrLines = [];
    let result = null;
    let engineError = null;

    readline.createInterface({ input: child.stderr }).on('line', (line) => {
      stderrLines.push(line);
      stderrLines.splice(0, stderrLines.length - STDERR_LINES_KEPT);
    });

    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      const event = parseEvent(line);

      if (event?.type === 'stage') {
        job.stage = event.stage;
        job.fraction = 0;
        job.device = event.device ?? job.device;
        this.onChange();
      } else if (event?.type === 'progress') {
        job.fraction = event.fraction;
        this.onChange();
      } else if (event?.type === 'done') {
        result = event;
      } else if (event?.type === 'error') {
        engineError = event.message;
      }
    });

    child.on('error', (error) => {
      engineError = error.message;
    });

    child.on('close', async () => {
      this.child = null;
      await this.finish(job, result, engineError ?? stderrLines.at(-1));
      this.runNext();
    });
  }

  async finish(job, result, errorMessage) {
    if (!this.jobs.includes(job)) {
      await library.deleteTemp(job.id);
      return;
    }

    if (job.cancelled) {
      await library.deleteTemp(job.id);
      this.dismiss(job.id);
      return;
    }

    if (!result) {
      await library.deleteTemp(job.id);
      this.fail(job, errorMessage ?? 'The audio engine stopped unexpectedly.');
      return;
    }

    try {
      await library.finishSong(job.id, {
        id: job.id,
        title: job.title,
        createdAt: new Date().toISOString(),
        duration: result.duration,
        stems: result.stems,
        device: result.device,
        model: result.model,
      });

      this.jobs = this.jobs.filter((candidate) => candidate !== job);
      this.onChange();
      this.onSongFinished(job.id);
    } catch (error) {
      await library.deleteTemp(job.id);
      this.fail(job, error.message);
    }
  }

  fail(job, message) {
    job.status = 'failed';
    job.error = message;
    this.onChange();
    this.runNext();
  }
}

function isEngineReady() {
  const requiredPaths = [pythonPath, ...ENGINE_PACKAGES.map((name) => path.join(sitePackagesDir, name))];

  return requiredPaths.every((requiredPath) => fs.existsSync(requiredPath));
}

function parseEvent(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

module.exports = { JobQueue };
