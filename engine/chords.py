import librosa
import numpy as np
import torch

from btc.btc_model import BTC_model
from music_theory import NO_CHORD_INDEX, UNKNOWN_CHORD_INDEX, chord_label


SAMPLE_RATE = 22050
HOP_LENGTH = 2048
BINS = 144
BINS_PER_OCTAVE = 24

# model input length in feature frames, about 10 seconds
WINDOW_FRAMES = 108

# windows overlap by half, and their predictions are averaged
WINDOW_STEP = WINDOW_FRAMES // 2
BATCH_SIZE = 16
CHORD_CLASSES = 170

# chance of staying on the same chord from one beat to the next
STAY_PROBABILITY = 0.9

# smallest probability used in the log, so one bad frame can't veto a chord
PROBABILITY_FLOOR = 1e-4

# length of each step when a song has no usable beats, in seconds
FALLBACK_STEP = 0.5

MODEL_CONFIG = {
    "feature_size": BINS,
    "timestep": WINDOW_FRAMES,
    "num_chords": CHORD_CLASSES,
    "input_dropout": 0.2,
    "layer_dropout": 0.2,
    "attention_dropout": 0.2,
    "relu_dropout": 0.2,
    "num_layers": 8,
    "num_heads": 4,
    "hidden_size": 128,
    "total_key_depth": 128,
    "total_value_depth": 128,
    "filter_size": 128,
    "loss": "ce",
    "probs_out": False,
}


def load_chord_model(model_path, device):
    checkpoint = torch.load(model_path, map_location="cpu", weights_only=False)

    model = BTC_model(config=MODEL_CONFIG)
    model.load_state_dict(checkpoint["model"])
    model.to(device)
    model.eval()

    return model, float(checkpoint["mean"]), float(checkpoint["std"])


def compute_features(signal):
    spectrum = librosa.cqt(
        signal,
        sr=SAMPLE_RATE,
        n_bins=BINS,
        bins_per_octave=BINS_PER_OCTAVE,
        hop_length=HOP_LENGTH,
        tuning=None,
    )

    return np.log(np.abs(spectrum) + 1e-6).T


def frame_probabilities(signal, model_path, device):
    model, mean, std = load_chord_model(model_path, device)
    features = (compute_features(signal) - mean) / std
    frame_count = features.shape[0]

    # pad so the final partial window still gets predicted
    padded_length = max(WINDOW_FRAMES, frame_count + WINDOW_FRAMES)
    padded = np.zeros((padded_length, BINS), dtype=np.float32)
    padded[:frame_count] = features

    starts = list(range(0, max(1, frame_count), WINDOW_STEP))
    summed = np.zeros((padded_length, CHORD_CLASSES), dtype=np.float64)
    counts = np.zeros(padded_length, dtype=np.float64)

    with torch.no_grad():
        for first in range(0, len(starts), BATCH_SIZE):
            batch_starts = starts[first:first + BATCH_SIZE]
            batch = np.stack([padded[start:start + WINDOW_FRAMES] for start in batch_starts])
            inputs = torch.from_numpy(batch).to(device)

            hidden, _ = model.self_attn_layers(inputs)
            logits = model.output_layer.output_projection(hidden)
            probabilities = torch.softmax(logits, dim=-1).cpu().numpy()

            for start, window in zip(batch_starts, probabilities):
                summed[start:start + WINDOW_FRAMES] += window
                counts[start:start + WINDOW_FRAMES] += 1

    probabilities = summed[:frame_count] / np.maximum(counts[:frame_count, None], 1)

    # treat "unknown chord" as "no chord", since neither gives you anything to play
    probabilities[:, NO_CHORD_INDEX] += probabilities[:, UNKNOWN_CHORD_INDEX]
    probabilities[:, UNKNOWN_CHORD_INDEX] = 0.0

    return probabilities


def build_time_grid(beats, duration):
    inner = beats[(beats > 0.0) & (beats < duration)]

    if len(inner) < 8:
        inner = np.arange(FALLBACK_STEP, duration, FALLBACK_STEP)

    return np.concatenate(([0.0], inner, [duration]))


def probabilities_per_step(probabilities, grid):
    frame_seconds = HOP_LENGTH / SAMPLE_RATE
    edges = np.round(grid / frame_seconds).astype(int)
    edges = np.clip(edges, 0, probabilities.shape[0])
    steps = np.zeros((len(grid) - 1, probabilities.shape[1]))

    for index in range(len(grid) - 1):
        first = edges[index]
        last = max(first + 1, edges[index + 1])
        window = probabilities[min(first, probabilities.shape[0] - 1):last]
        steps[index] = window.mean(axis=0)

    return steps


def viterbi(step_probabilities, stay_probability=STAY_PROBABILITY):
    step_count, class_count = step_probabilities.shape

    observations = np.log(np.maximum(step_probabilities, PROBABILITY_FLOOR))
    log_stay = np.log(stay_probability)
    log_switch = np.log((1.0 - stay_probability) / (class_count - 1))

    # scores: best log probability of ending on each chord at the current step
    scores = observations[0].copy()
    came_from = np.zeros((step_count, class_count), dtype=np.int32)

    for step in range(1, step_count):
        best_previous = int(np.argmax(scores))
        stay_scores = scores + log_stay
        switch_score = scores[best_previous] + log_switch

        switching = switch_score > stay_scores
        came_from[step] = np.where(switching, best_previous, np.arange(class_count))
        scores = np.where(switching, switch_score, stay_scores) + observations[step]

    path = np.zeros(step_count, dtype=np.int32)
    path[-1] = int(np.argmax(scores))

    for step in range(step_count - 1, 0, -1):
        path[step - 1] = came_from[step, path[step]]

    return path


def merge_steps(path, step_probabilities, grid):
    segments = []
    start_step = 0

    for step in range(1, len(path) + 1):
        if step == len(path) or path[step] != path[start_step]:
            index = int(path[start_step])

            segments.append({
                "start": float(grid[start_step]),
                "end": float(grid[step]),
                "index": index,
                "confidence": float(step_probabilities[start_step:step, index].mean()),
            })

            start_step = step

    return segments


def find_chord_segments(signal, beats, duration, model_path, device):
    probabilities = frame_probabilities(signal, model_path, device)
    grid = build_time_grid(beats, duration)
    steps = probabilities_per_step(probabilities, grid)
    path = viterbi(steps)

    return merge_steps(path, steps, grid)


def label_segments(segments, use_flats):
    return [
        {
            "start": round(segment["start"], 3),
            "end": round(segment["end"], 3),
            "label": chord_label(segment["index"], use_flats),
            "confidence": round(segment["confidence"], 3),
        }
        for segment in segments
    ]


def changes_per_minute(segments, duration):
    if duration <= 0:
        return 0.0

    return 60.0 * max(0, len(segments) - 1) / duration


def overall_confidence(segments):
    seconds = sum(segment["end"] - segment["start"] for segment in segments)

    if seconds <= 0:
        return 0.0

    weighted = sum(
        segment["confidence"] * (segment["end"] - segment["start"])
        for segment in segments
        if segment["index"] < UNKNOWN_CHORD_INDEX
    )

    return weighted / seconds
