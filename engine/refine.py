import argparse
import json
import sys
from pathlib import Path

import chord_crosscheck
import lyric_sections


EVENT_STREAM = sys.stdout

# length of each step when a song has no usable beats, in seconds, matching the chord finder
FALLBACK_STEP = 0.5


def emit(event_type, **fields):
    EVENT_STREAM.write(json.dumps({"type": event_type, **fields}) + "\n")
    EVENT_STREAM.flush()


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def write_json(path, value):
    temporary_path = path.with_name(path.name + ".tmp")
    temporary_path.write_text(json.dumps(value), encoding="utf-8")
    temporary_path.replace(path)


def beat_grid(analysis, duration):
    inner = [time for time in analysis.get("beats", []) if 0 < time < duration]

    if len(inner) < 8:
        count = int(duration / FALLBACK_STEP - 1e-9)
        inner = [round(FALLBACK_STEP * (index + 1), 3) for index in range(count)]

    return [0.0, *inner, duration]


def refine(analysis, lyrics, notes):
    # the first results are kept, so refining again always starts from the same place
    first = analysis.get("firstPass") or {"chords": analysis["chords"], "sections": analysis["sections"]}
    start_point = {**analysis, "chords": first["chords"], "sections": first["sections"]}

    sections = lyric_sections.sections_from_lyrics(start_point, lyrics, notes)
    sections_source = "lyrics" if sections else "sound"
    sections = sections or first["sections"]

    chords = first["chords"]
    changes = []

    if chords:
        duration = chords[-1]["end"]
        parts = (notes or {}).get("parts", {})
        use_flats = bool(analysis.get("key", {}).get("useFlats"))
        chords, changes = chord_crosscheck.crosscheck_chords(chords, sections, parts, beat_grid(analysis, duration), use_flats)

    return {
        **analysis,
        "chords": chords,
        "sections": sections,
        "firstPass": first,
        "crossChecks": {"sections": sections_source, "chordChanges": changes},
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--song-dir", required=True, type=Path)
    args = parser.parse_args()

    sys.stdout = sys.stderr
    emit("stage", stage="cross-checking")

    analysis = read_json(args.song_dir / "analysis.json")

    if analysis is None:
        raise RuntimeError("This song has not been analysed yet.")

    lyrics = read_json(args.song_dir / "lyrics-edited.json") or read_json(args.song_dir / "lyrics.json")
    notes = read_json(args.song_dir / "notes.json")
    refined = refine(analysis, lyrics, notes)

    write_json(args.song_dir / "analysis.json", refined)
    emit("done", sections=refined["crossChecks"]["sections"], chordChanges=len(refined["crossChecks"]["chordChanges"]))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit("error", message=str(error))
        raise
