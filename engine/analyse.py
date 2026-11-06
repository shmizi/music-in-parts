import argparse
import json
import sys
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf
import torch

import beats as beat_tracking
import chords as chord_finding
import evidence as note_evidence
import keys as key_finding
import sections as section_finding


EVENT_STREAM = sys.stdout
ANALYSIS_VERSION = 1

ANALYSIS_RATE = 22050
HARMONY_STEMS = ("bass", "guitar", "piano", "other")
UPPER_HARMONY_STEMS = ("guitar", "piano", "other")

# below this average model confidence, the chord names are too doubtful to rely on
RELIABLE_CONFIDENCE = 0.35

# music that barely changes chord, such as a drone, is better described by its notes
RELIABLE_CHANGES_PER_MINUTE = 2.0


def emit(event_type, **fields):
    EVENT_STREAM.write(json.dumps({"type": event_type, **fields}) + "\n")
    EVENT_STREAM.flush()


def write_json(path, value):
    temporary_path = path.with_name(path.name + ".tmp")
    temporary_path.write_text(json.dumps(value), encoding="utf-8")
    temporary_path.replace(path)


def read_stems(song_dir):
    stems = {}
    sample_rate = None

    for path in sorted((song_dir / "stems").glob("*.wav")):
        audio, sample_rate = sf.read(path, dtype="float32", always_2d=True)
        stems[path.stem] = audio.mean(axis=1)

    if not stems:
        raise RuntimeError("This song has no stems to analyse.")

    return stems, sample_rate


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--song-dir", required=True, type=Path)
    parser.add_argument("--chord-model", required=True, type=Path)
    args = parser.parse_args()

    sys.stdout = sys.stderr
    device = "cuda" if torch.cuda.is_available() else "cpu"

    emit("stage", stage="reading-stems", device=device)
    stems, sample_rate = read_stems(args.song_dir)

    mix = np.sum(list(stems.values()), axis=0)
    harmony = np.sum([stems[name] for name in HARMONY_STEMS if name in stems], axis=0)
    duration = len(mix) / sample_rate

    mix_low = librosa.resample(mix, orig_sr=sample_rate, target_sr=ANALYSIS_RATE)
    harmony_low = librosa.resample(harmony, orig_sr=sample_rate, target_sr=ANALYSIS_RATE)

    upper = np.sum([stems[name] for name in UPPER_HARMONY_STEMS if name in stems], axis=0)
    upper_low = librosa.resample(upper, orig_sr=sample_rate, target_sr=ANALYSIS_RATE)

    emit("stage", stage="finding-beats", device=device)
    beats, downbeats = beat_tracking.find_beats(mix, sample_rate, device)
    tempo = beat_tracking.summarise_tempo(beats, downbeats)

    emit("stage", stage="finding-chords", device=device)
    segments = chord_finding.find_chord_segments(harmony_low, beats, duration, args.chord_model, device)

    emit("stage", stage="finding-key", device=device)
    chroma = librosa.feature.chroma_cqt(y=harmony_low, sr=ANALYSIS_RATE, tuning=None)
    chroma_mean = chroma.mean(axis=1)
    key = key_finding.find_key(chroma_mean, segments)
    main_notes = key_finding.find_main_notes(chroma_mean, key["useFlats"])

    confidence = chord_finding.overall_confidence(segments)
    changes = chord_finding.changes_per_minute(segments, duration)

    emit("stage", stage="finding-sections", device=device)
    sections = section_finding.find_sections(mix_low, beats, downbeats, duration)

    emit("stage", stage="comparing-chords", device=device)
    grid = chord_finding.build_time_grid(beats, duration)
    chord_evidence = note_evidence.build_evidence(upper_low, harmony_low, grid)

    emit("stage", stage="writing")

    analysis = {
        "version": ANALYSIS_VERSION,
        "key": key,
        "tempo": tempo,
        "mainNotes": main_notes,
        "beats": [round(float(value), 3) for value in beats],
        "downbeats": [round(float(value), 3) for value in downbeats],
        "chords": chord_finding.label_segments(segments, key["useFlats"]),
        "chordConfidence": round(confidence, 3),
        "chordsReliable": bool(confidence >= RELIABLE_CONFIDENCE and changes >= RELIABLE_CHANGES_PER_MINUTE),
        "sections": sections,
    }

    write_json(args.song_dir / "chord-evidence.json", chord_evidence)
    write_json(args.song_dir / "analysis.json", analysis)

    emit("done", device=device)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit("error", message=str(error))
        raise
