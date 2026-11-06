import numpy as np
from beat_this.inference import Audio2Beats


CHECKPOINT = "final0"
MINIMUM_BEATS = 8

# tempo drift above this fraction of the beat length counts as an unsteady tempo
STEADY_LIMIT = 0.06


def find_beats(mix, sample_rate, device):
    tracker = Audio2Beats(checkpoint_path=CHECKPOINT, device=device, dbn=False)
    beats, downbeats = tracker(mix, sample_rate)

    return np.asarray(beats, dtype=float), np.asarray(downbeats, dtype=float)


def summarise_tempo(beats, downbeats):
    if len(beats) < MINIMUM_BEATS:
        return {"bpm": None, "beatsPerBar": None, "steady": False, "confidence": 0.0}

    # beat_lengths: seconds between neighbouring beats
    beat_lengths = np.diff(beats)
    typical_length = float(np.median(beat_lengths))

    # drift: how much the beat length varies, as a fraction of a typical beat
    drift = float(np.median(np.abs(beat_lengths - typical_length))) / typical_length
    steady = drift < STEADY_LIMIT

    return {
        "bpm": round(60.0 / typical_length, 1),
        "beatsPerBar": beats_per_bar(beats, downbeats),
        "steady": bool(steady),
        "confidence": round(float(np.clip(1.0 - drift / (2 * STEADY_LIMIT), 0.0, 1.0)), 2),
    }


def beats_per_bar(beats, downbeats):
    if len(downbeats) < 2:
        return None

    counts = np.diff(np.searchsorted(beats, downbeats))
    counts = counts[counts > 0]

    if len(counts) == 0:
        return None

    return int(np.median(counts))
