import { Player, computePeaks } from './player.mjs';

const STEM_ORDER = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'];
const PEAK_BUCKETS = 2000;
const DRAG_THRESHOLD_PX = 5;
const MINIMUM_LOOP_SECONDS = 0.25;

const STAGE_LABELS = {
  decoding: 'Reading the file',
  'loading-model': 'Loading the model',
  separating: 'Separating stems',
  writing: 'Saving stems',
};

const elements = {
  addSongs: document.getElementById('add-songs'),
  jobsSection: document.getElementById('jobs-section'),
  jobs: document.getElementById('jobs'),
  songs: document.getElementById('songs'),
  libraryEmpty: document.getElementById('library-empty'),
  main: document.getElementById('main'),
  emptyState: document.getElementById('empty-state'),
  songView: document.getElementById('song-view'),
  songTitle: document.getElementById('song-title'),
  exportStems: document.getElementById('export-stems'),
  deleteSong: document.getElementById('delete-song'),
  play: document.getElementById('play'),
  time: document.getElementById('time'),
  seek: document.getElementById('seek'),
  speed: document.getElementById('speed'),
  speedValue: document.getElementById('speed-value'),
  clearLoop: document.getElementById('clear-loop'),
  status: document.getElementById('song-status'),
  trackRows: document.getElementById('track-rows'),
  overlay: document.getElementById('overlay'),
  loopRegion: document.getElementById('loop-region'),
  playhead: document.getElementById('playhead'),
};

const state = {
  songs: [],
  current: null,
  tracks: [],
  playing: false,
  position: 0,
  scrubbing: false,
  loop: null,
  loadToken: 0,
};

const player = new Player({
  onPosition: (seconds) => {
    state.position = seconds;
    showPosition();
  },
  onEnded: () => setPlaying(false),
});

function formatTime(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const remainder = String(whole % 60).padStart(2, '0');

  return `${minutes}:${remainder}`;
}

function setStatus(message) {
  elements.status.textContent = message;
}

function showPosition() {
  if (!state.current) {
    return;
  }

  const duration = state.current.duration;
  const shown = state.scrubbing ? Number(elements.seek.value) : state.position;

  elements.time.textContent = `${formatTime(shown)} / ${formatTime(duration)}`;
  elements.playhead.style.left = `${(state.position / duration) * 100}%`;

  if (!state.scrubbing) {
    elements.seek.value = state.position;
  }
}

function setPlaying(playing) {
  state.playing = playing;
  elements.play.textContent = playing ? 'Pause' : 'Play';
}

function togglePlaying() {
  if (!state.current || state.tracks.length === 0) {
    return;
  }

  if (state.playing) {
    player.pause();
  } else {
    player.play();
  }

  setPlaying(!state.playing);
}

function currentGains() {
  const anySolo = state.tracks.some((track) => track.solo);

  return state.tracks.map((track) => {
    if (anySolo) {
      return track.solo ? track.volume : 0;
    }

    return track.muted ? 0 : track.volume;
  });
}

function drawTrack(track) {
  const canvas = track.canvas;
  const width = Math.round(canvas.clientWidth * devicePixelRatio);
  const height = Math.round(canvas.clientHeight * devicePixelRatio);

  if (width === 0 || height === 0) {
    return;
  }

  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  const middle = height / 2;
  const { minimums, maximums } = track.peaks;

  context.fillStyle = getComputedStyle(canvas).color;

  for (let x = 0; x < width; x++) {
    const first = Math.floor((x / width) * PEAK_BUCKETS);
    const last = Math.max(first + 1, Math.floor(((x + 1) / width) * PEAK_BUCKETS));
    let low = 0;
    let high = 0;

    for (let bucket = first; bucket < last; bucket++) {
      low = Math.min(low, minimums[bucket]);
      high = Math.max(high, maximums[bucket]);
    }

    const top = middle - high * middle;
    const bottom = middle - low * middle;

    context.fillRect(x, top, 1, Math.max(1, bottom - top));
  }
}

function createButton(label, title, onClick) {
  const button = document.createElement('button');

  button.type = 'button';
  button.textContent = label;
  button.title = title;
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', () => onClick(button));

  return button;
}

function createTrackRow(track) {
  const row = document.createElement('div');
  row.className = 'track';

  const controls = document.createElement('div');
  controls.className = 'track-controls';

  const name = document.createElement('span');
  name.className = 'track-name';
  name.textContent = track.name;

  const mute = createButton('M', `Mute ${track.name}`, (button) => {
    track.muted = !track.muted;
    button.setAttribute('aria-pressed', String(track.muted));
    player.setGains(currentGains());
  });

  const solo = createButton('S', `Solo ${track.name}`, (button) => {
    track.solo = !track.solo;
    button.setAttribute('aria-pressed', String(track.solo));
    player.setGains(currentGains());
  });

  const volume = document.createElement('input');
  volume.type = 'range';
  volume.min = '0';
  volume.max = '1';
  volume.step = '0.01';
  volume.value = '1';
  volume.setAttribute('aria-label', `${track.name} volume`);
  volume.addEventListener('input', () => {
    track.volume = Number(volume.value);
    player.setGains(currentGains());
  });

  controls.append(name, mute, solo, volume);

  const wave = document.createElement('div');
  wave.className = 'track-wave';

  const canvas = document.createElement('canvas');
  wave.append(canvas);
  attachWaveInteraction(wave);

  row.append(controls, wave);
  track.canvas = canvas;

  return row;
}

function secondsAtPointer(event, wave) {
  const bounds = wave.getBoundingClientRect();
  const fraction = (event.clientX - bounds.left) / bounds.width;

  return Math.max(0, Math.min(1, fraction)) * state.current.duration;
}

function attachWaveInteraction(wave) {
  wave.addEventListener('pointerdown', (event) => {
    wave.setPointerCapture(event.pointerId);

    const startX = event.clientX;
    const startSeconds = secondsAtPointer(event, wave);
    let dragging = false;

    const onMove = (moveEvent) => {
      if (Math.abs(moveEvent.clientX - startX) >= DRAG_THRESHOLD_PX) {
        dragging = true;
      }

      if (dragging) {
        showLoopRegion(startSeconds, secondsAtPointer(moveEvent, wave));
      }
    };

    const onUp = (upEvent) => {
      wave.removeEventListener('pointermove', onMove);
      wave.removeEventListener('pointerup', onUp);

      if (!dragging) {
        seekTo(startSeconds);
        return;
      }

      applyLoop(startSeconds, secondsAtPointer(upEvent, wave));
    };

    wave.addEventListener('pointermove', onMove);
    wave.addEventListener('pointerup', onUp);
  });
}

function showLoopRegion(firstSeconds, secondSeconds) {
  const duration = state.current.duration;
  const start = Math.min(firstSeconds, secondSeconds);
  const end = Math.max(firstSeconds, secondSeconds);

  elements.loopRegion.hidden = false;
  elements.loopRegion.style.left = `${(start / duration) * 100}%`;
  elements.loopRegion.style.width = `${((end - start) / duration) * 100}%`;
}

function applyLoop(firstSeconds, secondSeconds) {
  const start = Math.min(firstSeconds, secondSeconds);
  const end = Math.max(firstSeconds, secondSeconds);

  if (end - start < MINIMUM_LOOP_SECONDS) {
    clearLoop();
    return;
  }

  state.loop = { start, end };
  showLoopRegion(start, end);
  elements.clearLoop.disabled = false;
  player.setLoop(start, end);
  seekTo(start);
}

function clearLoop() {
  state.loop = null;
  elements.loopRegion.hidden = true;
  elements.clearLoop.disabled = true;
  player.setLoop(null, null);
}

function seekTo(seconds) {
  state.position = seconds;
  player.seek(seconds);
  showPosition();
}

function renderSongs() {
  elements.songs.replaceChildren(
    ...state.songs.map((song) => {
      const item = document.createElement('li');
      const button = document.createElement('button');

      button.type = 'button';
      button.textContent = song.title;
      button.title = song.title;
      button.setAttribute('aria-current', String(song.id === state.current?.id));
      button.addEventListener('click', () => openSong(song));

      item.append(button);
      return item;
    }),
  );

  elements.libraryEmpty.hidden = state.songs.length > 0;
}

function renderJobs(jobs) {
  elements.jobsSection.hidden = jobs.length === 0;

  elements.jobs.replaceChildren(
    ...jobs.map((job) => {
      const item = document.createElement('li');
      item.className = 'job';

      const title = document.createElement('div');
      title.className = 'job-title';
      title.textContent = job.title;
      title.title = job.title;
      item.append(title);

      if (job.status === 'failed') {
        const error = document.createElement('div');
        error.className = 'job-error';
        error.textContent = job.error;
        item.append(error);
      } else {
        const detail = document.createElement('div');
        detail.className = 'job-detail';
        detail.textContent = describeJob(job);
        item.append(detail);
      }

      if (job.status === 'running') {
        const progress = document.createElement('progress');

        if (job.stage === 'separating') {
          progress.value = job.fraction;
        }

        item.append(progress);
      }

      const cancelLabel = job.status === 'failed' ? 'Dismiss' : 'Cancel';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = cancelLabel;
      cancel.addEventListener('click', () => window.api.cancelJob(job.id));
      item.append(cancel);

      return item;
    }),
  );
}

function describeJob(job) {
  if (job.status === 'queued') {
    return 'Waiting';
  }

  const stage = STAGE_LABELS[job.stage] ?? 'Starting';

  if (job.stage === 'separating') {
    const percent = Math.round(job.fraction * 100);
    const device = job.device === 'cuda' ? 'graphics card' : 'CPU, this will be slow';

    return `${stage}: ${percent}% (${device})`;
  }

  return stage;
}

function unloadSong() {
  state.loadToken += 1;
  state.current = null;
  state.tracks = [];
  player.pause();
  player.load([]);
  setPlaying(false);
  elements.songView.hidden = true;
  elements.emptyState.hidden = false;
  renderSongs();
}

async function openSong(song) {
  if (state.current?.id === song.id) {
    return;
  }

  const token = ++state.loadToken;

  player.pause();
  setPlaying(false);

  state.current = song;
  state.tracks = [];
  state.position = 0;
  state.loop = null;

  elements.emptyState.hidden = true;
  elements.songView.hidden = false;
  elements.songTitle.textContent = song.title;
  elements.seek.max = song.duration;
  elements.seek.value = 0;
  elements.play.disabled = true;
  elements.trackRows.replaceChildren();
  elements.loopRegion.hidden = true;
  elements.clearLoop.disabled = true;
  setStatus('Loading stems...');
  showPosition();
  renderSongs();

  try {
    const names = STEM_ORDER.filter((name) => song.stems.includes(name));

    const decoded = await Promise.all(
      names.map(async (name) => player.decode(await window.api.readStem(song.id, name))),
    );

    if (token !== state.loadToken) {
      return;
    }

    state.tracks = names.map((name, index) => ({
      name,
      peaks: computePeaks(decoded[index], PEAK_BUCKETS),
      muted: false,
      solo: false,
      volume: 1,
      canvas: null,
    }));

    player.load(decoded);
    player.setRate(Number(elements.speed.value) / 100);

    elements.trackRows.replaceChildren(...state.tracks.map(createTrackRow));
    state.tracks.forEach(drawTrack);

    elements.play.disabled = false;
    setStatus('');
  } catch (error) {
    if (token === state.loadToken) {
      setStatus(`Could not load this song: ${error.message}`);
    }
  }
}

async function refreshSongs() {
  state.songs = await window.api.listSongs();
  renderSongs();
}

function bindControls() {
  elements.addSongs.addEventListener('click', () => window.api.chooseSongs());
  elements.play.addEventListener('click', togglePlaying);
  elements.clearLoop.addEventListener('click', clearLoop);

  elements.seek.addEventListener('input', () => {
    state.scrubbing = true;
    showPosition();
  });

  elements.seek.addEventListener('change', () => {
    state.scrubbing = false;
    seekTo(Number(elements.seek.value));
  });

  elements.speed.addEventListener('input', () => {
    elements.speedValue.textContent = `${elements.speed.value}%`;
    player.setRate(Number(elements.speed.value) / 100);
  });

  elements.exportStems.addEventListener('click', async () => {
    try {
      const result = await window.api.exportStems(state.current.id);

      if (result) {
        setStatus(`Exported ${result.count} stems to ${result.folder}`);
      }
    } catch (error) {
      setStatus(`Could not export: ${error.message}`);
    }
  });

  elements.deleteSong.addEventListener('click', async () => {
    const deleted = await window.api.deleteSong(state.current.id);

    if (deleted) {
      unloadSong();
      await refreshSongs();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.code === 'Space' && !event.repeat) {
      event.preventDefault();
      togglePlaying();
    }
  });

  document.addEventListener('dragover', (event) => {
    event.preventDefault();
    elements.main.classList.add('drop-target');
  });

  document.addEventListener('dragleave', (event) => {
    if (event.relatedTarget === null) {
      elements.main.classList.remove('drop-target');
    }
  });

  document.addEventListener('drop', (event) => {
    event.preventDefault();
    elements.main.classList.remove('drop-target');

    const paths = [...event.dataTransfer.files]
      .map((file) => window.api.pathForFile(file))
      .filter(Boolean);

    if (paths.length > 0) {
      window.api.addPaths(paths);
    }
  });

  new ResizeObserver(() => state.tracks.forEach(drawTrack)).observe(elements.trackRows);
}

async function start() {
  await player.init();
  bindControls();

  window.api.onJobsChanged(renderJobs);

  window.api.onSongFinished(async (songId) => {
    await refreshSongs();

    if (!state.current) {
      const finished = state.songs.find((song) => song.id === songId);
      openSong(finished);
    }
  });

  renderJobs(await window.api.listJobs());
  await refreshSongs();
}

start();
