import argparse
import json
import logging
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

logging.getLogger().setLevel(logging.ERROR)

import pretty_midi  # noqa: E402
from basic_pitch import ICASSP_2022_MODEL_PATH  # noqa: E402
from basic_pitch.inference import Model, predict  # noqa: E402


EVENT_STREAM = sys.stdout
NOTES_VERSION = 1

# what each stem is listened for: lowest and highest pitch in Hz, and the MIDI instrument used on export
STEM_SETTINGS = {
    "guitar": {"low": 75.0, "high": 1500.0, "program": 27, "single_line": False},
    "piano": {"low": 27.0, "high": 4200.0, "program": 0, "single_line": False},
    "bass": {"low": 30.0, "high": 400.0, "program": 33, "single_line": True},
    "vocals": {"low": 80.0, "high": 1100.0, "program": 73, "single_line": True},
    "other": {"low": 50.0, "high": 4000.0, "program": 48, "single_line": False},
}

MELODIC_STEMS = ("guitar", "piano", "other")

# stems quieter than this, in decibels below full scale, are treated as silent
SILENT_STEM_DB = -50.0

# notes quieter than this, from 0 to 1, are dropped as bleed from other instruments
QUIETEST_NOTE = 0.2

# shortest note kept, in milliseconds
SHORTEST_NOTE_MS = 80.0

# a lead part must make up at least this share of the melodic instruments' sound
LEAD_SHARE = 0.45

# a lead line plays at least this many notes a second
LEAD_NOTES_PER_SECOND = 1.5

# a lead line mostly plays one note at a time; this is the most notes sounding together on average
LEAD_MOST_VOICES = 1.8

# notes softer than this share of the loudest note nearby are treated as bleed when judging a lead line
LEAD_NOTE_SHARE = 0.65

# a lead part is at least this much louder than its usual level in the song
LEAD_LIFT = 1.4

# a melody moves around, so a bar of lead line uses at least this many different notes
LEAD_DISTINCT_PITCHES = 3

# singing within this many decibels of the song's loudest singing means it isn't a solo
SINGING_RANGE_DB = 30.0

# shortest stretch counted as a solo, in seconds
SHORTEST_SOLO = 4.0

# window length used when the song has no bar lines, in seconds
FALLBACK_WINDOW = 2.0

SOLO_NAMES = {"guitar": "Guitar solo", "piano": "Piano solo", "other": "Lead line"}


def emit(event_type, **fields):
    EVENT_STREAM.write(json.dumps({"type": event_type, **fields}) + "\n")
    EVENT_STREAM.flush()


def write_json(path, value):
    temporary_path = path.with_name(path.name + ".tmp")
    temporary_path.write_text(json.dumps(value), encoding="utf-8")
    temporary_path.replace(path)


def read_mono(path):
    audio, rate = sf.read(path, dtype="float32", always_2d=True)
    return audio.mean(axis=1), rate


def loudness_db(signal):
    if len(signal) == 0:
        return -120.0

    return float(20 * np.log10(max(np.sqrt(np.mean(signal ** 2)), 1e-10)))


def keep_single_line(notes):
    kept = []

    for note in sorted(notes, key=lambda item: item[0]):
        if kept and note[0] < kept[-1][1]:
            if note[3] > kept[-1][3]:
                kept[-1] = [kept[-1][0], note[0], kept[-1][2], kept[-1][3]]

                if kept[-1][1] - kept[-1][0] < SHORTEST_NOTE_MS / 1000:
                    kept.pop()

                kept.append(note)

            continue

        kept.append(note)

    return kept


def clean_notes(events, single_line):
    notes = [
        [round(float(start), 3), round(float(end), 3), int(pitch), round(float(amplitude), 3)]
        for start, end, pitch, amplitude, _ in events
        if amplitude >= QUIETEST_NOTE and (end - start) * 1000 >= SHORTEST_NOTE_MS
    ]

    notes.sort(key=lambda note: (note[0], note[2]))

    return keep_single_line(notes) if single_line else notes


def transcribe_stem(model, path, settings):
    _, _, events = predict(
        str(path),
        model,
        onset_threshold=0.5,
        frame_threshold=0.3,
        minimum_note_length=SHORTEST_NOTE_MS,
        minimum_frequency=settings["low"],
        maximum_frequency=settings["high"],
        multiple_pitch_bends=False,
        melodia_trick=True,
    )

    return clean_notes(events, settings["single_line"])


def window_edges(analysis, duration):
    downbeats = [time for time in (analysis or {}).get("downbeats", []) if 0 < time < duration]

    if len(downbeats) >= 4:
        return [0.0, *downbeats, duration]

    return list(np.arange(0.0, duration, FALLBACK_WINDOW)) + [duration]


def singing_flags(vocals, rate, edges):
    levels = [loudness_db(vocals[int(start * rate):int(end * rate)]) for start, end in zip(edges[:-1], edges[1:])]

    if not levels:
        return []

    loudest = np.percentile(levels, 95)
    threshold = max(loudest - SINGING_RANGE_DB, SILENT_STEM_DB)

    return [level > threshold for level in levels]


def notes_between(notes, start, end):
    return [note for note in notes if note[0] < end and note[1] > start]


def typical_levels(stems, rate, edges):
    typical = {}

    for name in MELODIC_STEMS:
        if name in stems:
            levels = [
                float(np.sqrt(np.mean(stems[name][int(start * rate):int(end * rate)] ** 2)))
                for start, end in zip(edges[:-1], edges[1:])
            ]
            typical[name] = float(np.median(levels)) if levels else 0.0

    return typical


def window_lead(window_start, window_end, stems, notes_by_stem, rate, typical):
    levels = {}

    for name in MELODIC_STEMS:
        if name in stems:
            piece = stems[name][int(window_start * rate):int(window_end * rate)]
            levels[name] = float(np.sqrt(np.mean(piece ** 2))) if len(piece) else 0.0

    total = sum(levels.values())

    if total <= 0:
        return None

    best = max(levels, key=levels.get)
    share = levels[best] / total
    length = window_end - window_start
    notes = notes_between(notes_by_stem.get(best, []), window_start, window_end)

    if not notes or length <= 0:
        return None

    loudest = max(note[3] for note in notes)
    notes = [note for note in notes if note[3] >= LEAD_NOTE_SHARE * loudest]
    lift = levels[best] / max(typical.get(best, 0.0), 1e-9)

    # voices: how many notes sound at once on average while the part is playing
    sounding = sum(min(note[1], window_end) - max(note[0], window_start) for note in notes)
    covered = min(length, max(note[1] for note in notes) - min(note[0] for note in notes))
    voices = sounding / max(covered, 1e-6)
    rate_of_notes = len(notes) / length

    stands_out = share >= LEAD_SHARE and lift >= LEAD_LIFT
    moves = len({note[2] for note in notes}) >= LEAD_DISTINCT_PITCHES

    if stands_out and moves and rate_of_notes >= LEAD_NOTES_PER_SECOND and voices <= LEAD_MOST_VOICES:
        return {"stem": best, "score": share}

    return None


def find_solos(stems, notes_by_stem, rate, analysis, duration):
    edges = window_edges(analysis, duration)
    singing = singing_flags(stems["vocals"], rate, edges) if "vocals" in stems else [False] * (len(edges) - 1)
    typical = typical_levels(stems, rate, edges)
    runs = []

    for index, (start, end) in enumerate(zip(edges[:-1], edges[1:])):
        lead = None if singing[index] else window_lead(start, end, stems, notes_by_stem, rate, typical)

        if lead and runs and runs[-1]["stem"] == lead["stem"] and abs(runs[-1]["end"] - start) < 1e-6:
            runs[-1]["end"] = end
            runs[-1]["scores"].append(lead["score"])
        elif lead:
            runs.append({"start": start, "end": end, "stem": lead["stem"], "scores": [lead["score"]]})

    return [
        {
            "start": round(float(run["start"]), 3),
            "end": round(float(run["end"]), 3),
            "stem": run["stem"],
            "label": SOLO_NAMES[run["stem"]],
            "confidence": round(float(np.mean(run["scores"])), 3),
            "notes": keep_single_line(notes_between(notes_by_stem[run["stem"]], run["start"], run["end"])),
        }
        for run in runs
        if run["end"] - run["start"] >= SHORTEST_SOLO
    ]


def write_midi(notes, settings, path, bpm):
    midi = pretty_midi.PrettyMIDI(initial_tempo=bpm)
    instrument = pretty_midi.Instrument(program=settings["program"])

    for start, end, pitch, amplitude in notes:
        velocity = int(np.clip(30 + amplitude * 97, 1, 127))
        instrument.notes.append(pretty_midi.Note(velocity=velocity, pitch=pitch, start=start, end=end))

    midi.instruments.append(instrument)
    midi.write(str(path))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--song-dir", required=True, type=Path)
    args = parser.parse_args()

    sys.stdout = sys.stderr
    song_dir = args.song_dir
    analysis_path = song_dir / "analysis.json"
    analysis = json.loads(analysis_path.read_text(encoding="utf-8")) if analysis_path.exists() else None
    bpm = float((analysis or {}).get("tempo", {}).get("bpm") or 120.0)

    stems = {}
    rate = None

    emit("stage", stage="reading-stems")

    for name in [*STEM_SETTINGS, "drums"]:
        path = song_dir / "stems" / f"{name}.wav"

        if path.exists():
            stems[name], rate = read_mono(path)

    duration = max(len(signal) for signal in stems.values()) / rate
    model = Model(ICASSP_2022_MODEL_PATH)
    midi_dir = song_dir / "midi"
    midi_dir.mkdir(exist_ok=True)

    parts = {}
    names = [name for name in STEM_SETTINGS if name in stems]

    for position, name in enumerate(names):
        emit("stage", stage="transcribing-notes", part=name)
        emit("progress", fraction=position / len(names))

        if loudness_db(stems[name]) < SILENT_STEM_DB:
            continue

        notes = transcribe_stem(model, song_dir / "stems" / f"{name}.wav", STEM_SETTINGS[name])

        if notes:
            parts[name] = {"program": STEM_SETTINGS[name]["program"], "notes": notes}
            write_midi(notes, STEM_SETTINGS[name], midi_dir / f"{name}.mid", bpm)

    emit("progress", fraction=1.0)
    emit("stage", stage="finding-solos")

    notes_by_stem = {name: part["notes"] for name, part in parts.items()}
    solos = find_solos(stems, notes_by_stem, rate, analysis, duration)

    write_json(song_dir / "notes.json", {
        "version": NOTES_VERSION,
        "bpm": bpm,
        "parts": parts,
        "solos": solos,
    })

    emit("done", parts=list(parts), solos=len(solos))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit("error", message=str(error))
        raise
