import librosa
import numpy as np


SAMPLE_RATE = 22050
HOP_LENGTH = 512

# lowest note considered, leaving out the bass whose overtones can fake a third
LOWEST_NOTE = "C3"
OCTAVES = 4
BINS_PER_OCTAVE = 36

# saved levels run from 0 to this, which keeps the file small
LEVEL_SCALE = 255

# without enough sound above the bass, the bass is all there is to go on
MINIMUM_UPPER_SHARE = 0.05


def choose_signal(upper, full):
    full_level = np.sqrt(np.mean(full ** 2))

    if full_level <= 0:
        return full

    upper_level = np.sqrt(np.mean(upper ** 2))

    return upper if upper_level / full_level >= MINIMUM_UPPER_SHARE else full


def note_levels(signal, grid):
    # chroma: 12 x frames matrix, the energy of each note name in each frame
    chroma = librosa.feature.chroma_cqt(
        y=signal,
        sr=SAMPLE_RATE,
        hop_length=HOP_LENGTH,
        fmin=librosa.note_to_hz(LOWEST_NOTE),
        n_octaves=OCTAVES,
        bins_per_octave=BINS_PER_OCTAVE,
        norm=None,
        threshold=0.0,
        tuning=None,
    )

    frame_count = chroma.shape[1]
    edges = librosa.time_to_frames(grid, sr=SAMPLE_RATE, hop_length=HOP_LENGTH)
    edges = np.clip(edges, 0, frame_count)
    steps = np.zeros((len(grid) - 1, 12))

    for index in range(len(grid) - 1):
        first = min(edges[index], frame_count - 1)
        last = max(first + 1, edges[index + 1])
        steps[index] = chroma[:, first:last].mean(axis=1)

    strongest = steps.max()

    if strongest > 0:
        steps = steps / strongest

    return steps


def build_evidence(upper, full, grid):
    levels = note_levels(choose_signal(upper, full), grid)

    return {
        "grid": [round(float(value), 3) for value in grid],
        "levels": np.round(levels * LEVEL_SCALE).astype(int).tolist(),
    }
