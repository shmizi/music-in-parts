import re
from collections import Counter

from music_theory import FLAT_NAMES, NO_CHORD_LABEL, QUALITY_INTERVALS, QUALITY_SUFFIXES, SHARP_NAMES


PITCH_CLASSES = {name: index for names in (SHARP_NAMES, FLAT_NAMES) for index, name in enumerate(names)}
QUALITY_BY_SUFFIX = {suffix: quality for quality, suffix in QUALITY_SUFFIXES.items()}
CHORD_LABEL = re.compile(r"^([A-G][#b]?)([^/]*)(?:/([A-G][#b]?))?$")

# the chord with the other third, for the chords where only the third tells them apart
OTHER_THIRD = {"maj": "min", "min": "maj", "7": "min7", "min7": "7", "maj6": "min6", "min6": "maj6"}
MINOR_THIRD_QUALITIES = ("min", "min7", "min6")
SHARP_ROOTS = ("G", "D", "A", "E", "B")

# stems whose notes say which chord is being played, and how much each one counts
CHORD_STEMS = {"guitar": 1.0, "piano": 1.0, "other": 1.0, "vocals": 0.5}

# chords shorter than this are too brief for their notes to be trusted, in seconds
SHORTEST_CHECKED_CHORD = 0.9

# the notes in a chord must add up to at least this, in seconds of full-volume playing, to be trusted
MINIMUM_NOTE_WEIGHT = 0.4

# the other third must be this many times stronger than the named third to change the chord
THIRD_RATIO_TO_MINOR = 3.0

# overtones of the root can sound like a major third, so going from minor to major needs more proof
THIRD_RATIO_TO_MAJOR = 5.0

# the other third must make up at least this share of all the notes heard in the chord
THIRD_SHARE = 0.12

# the bass must sit on one note for at least this share of the chord to name a slash chord
BASS_SHARE = 0.65

# the bass must be playing for at least this share of the chord's length
BASS_PRESENCE = 0.4

# a repeated section needs at least this many copies before they can outvote one of them
MINIMUM_COPIES = 3

# a copy takes part in the vote only when this share of its beats match the others
COPY_AGREEMENT = 0.6

# how far a copy may be slid to line it up with the others, in beats either way
MOST_SHIFT_BEATS = 8


def parse_label(label):
    match = CHORD_LABEL.match(label or "")

    if not match or match.group(2) not in QUALITY_BY_SUFFIX:
        return None

    return {
        "root": PITCH_CLASSES[match.group(1)],
        "quality": QUALITY_BY_SUFFIX[match.group(2)],
        "bass": match.group(3),
    }


def build_label(root, quality, use_flats):
    names = FLAT_NAMES if use_flats else SHARP_NAMES
    return names[root] + QUALITY_SUFFIXES[quality]


def without_bass(label):
    return label.split("/")[0]


def note_weights(notes, start, end, scale=1.0):
    # weights: for each of the 12 note names, how long and how loudly it sounds between start and end
    weights = [0.0] * 12

    for note_start, note_end, pitch, loudness in notes:
        overlap = min(end, note_end) - max(start, note_start)

        if overlap > 0:
            weights[pitch % 12] += overlap * loudness * scale

    return weights


def chord_weights(parts, start, end):
    totals = [0.0] * 12

    for stem, scale in CHORD_STEMS.items():
        notes = parts.get(stem, {}).get("notes", [])

        for index, weight in enumerate(note_weights(notes, start, end, scale)):
            totals[index] += weight

    return totals


def check_third(chord, parts, use_flats):
    parsed = parse_label(chord["label"])

    if not parsed or parsed["quality"] not in OTHER_THIRD or chord["end"] - chord["start"] < SHORTEST_CHECKED_CHORD:
        return None

    weights = chord_weights(parts, chord["start"], chord["end"])
    total = sum(weights)

    if total < MINIMUM_NOTE_WEIGHT:
        return None

    is_minor = parsed["quality"] in MINOR_THIRD_QUALITIES
    named = weights[(parsed["root"] + (3 if is_minor else 4)) % 12]
    other = weights[(parsed["root"] + (4 if is_minor else 3)) % 12]
    ratio = THIRD_RATIO_TO_MAJOR if is_minor else THIRD_RATIO_TO_MINOR

    if other / total >= THIRD_SHARE and other >= ratio * named:
        return build_label(parsed["root"], OTHER_THIRD[parsed["quality"]], use_flats)

    return None


def check_bass(chord, parts, use_flats):
    parsed = parse_label(chord["label"])
    length = chord["end"] - chord["start"]

    if not parsed or length < SHORTEST_CHECKED_CHORD:
        return None

    bass_notes = parts.get("bass", {}).get("notes", [])
    sounding = sum(max(0.0, min(chord["end"], end) - max(chord["start"], start)) for start, end, _, _ in bass_notes)
    weights = note_weights(bass_notes, chord["start"], chord["end"])
    total = sum(weights)

    if total <= 0 or sounding < BASS_PRESENCE * length:
        return None

    lowest = max(range(12), key=lambda index: weights[index])
    chord_notes = [(parsed["root"] + interval) % 12 for interval in QUALITY_INTERVALS[parsed["quality"]]]

    if lowest == parsed["root"] or lowest not in chord_notes or weights[lowest] / total < BASS_SHARE:
        return None

    return f"{without_bass(chord['label'])}/{bass_name(chord['label'], lowest, use_flats)}"


def bass_name(label, pitch_class, use_flats):
    # the bass note is spelled the same way as its chord, so B gets F# and Bb gets F
    root = CHORD_LABEL.match(label).group(1)

    if "#" in root or root in SHARP_ROOTS:
        return SHARP_NAMES[pitch_class]

    if "b" in root or root == "F":
        return FLAT_NAMES[pitch_class]

    return (FLAT_NAMES if use_flats else SHARP_NAMES)[pitch_class]


def to_steps(chords, grid):
    # steps: the chord playing in each beat of the song, as an index into chords
    steps = []
    index = 0

    for start, end in zip(grid[:-1], grid[1:]):
        middle = (start + end) / 2

        while index < len(chords) - 1 and chords[index]["end"] <= middle:
            index += 1

        steps.append(index)

    return steps


def section_groups(sections):
    groups = {}

    for section in sections:
        base = re.sub(r" \d+$", "", section["label"])
        groups.setdefault(base, []).append(section)

    return [copies for copies in groups.values() if len(copies) >= MINIMUM_COPIES]


def steps_of(section, grid):
    return [index for index in range(len(grid) - 1) if section["start"] - 1e-3 <= grid[index] < section["end"] - 1e-3]


def agreement(first, second, labels):
    shared = min(len(first), len(second))

    if shared == 0:
        return 0.0

    return sum(labels[a] == labels[b] for a, b in zip(first, second)) / shared


def line_up(reference, copy, labels, step_count):
    best = (agreement(reference, copy, labels), copy)

    for shift in range(-MOST_SHIFT_BEATS, MOST_SHIFT_BEATS + 1):
        shifted = [step + shift for step in copy if 0 <= step + shift < step_count]
        score = agreement(reference, shifted, labels)

        # a small bonus for not sliding, so equal scores keep the copy where it is
        if score > best[0] + 0.02:
            best = (score, shifted)

    return best


def vote(chords, sections, grid):
    step_chords = to_steps(chords, grid)
    labels = [without_bass(chords[index]["label"]) for index in step_chords]
    confidence = [chords[index]["confidence"] for index in step_chords]
    changes = {}

    for copies in section_groups(sections):
        step_lists = [steps_of(section, grid) for section in copies]
        step_lists = [steps for steps in step_lists if steps]

        if len(step_lists) < MINIMUM_COPIES:
            continue

        reference = max(step_lists, key=lambda steps: sum(confidence[step] for step in steps) / len(steps))
        lined_up = [line_up(reference, steps, labels, len(labels)) for steps in step_lists]
        voters = [steps for score, steps in lined_up if score >= COPY_AGREEMENT]

        if len(voters) < MINIMUM_COPIES:
            continue

        for offset in range(max(len(steps) for steps in voters)):
            present = [steps[offset] for steps in voters if offset < len(steps)]

            if len(present) < MINIMUM_COPIES:
                continue

            tally = Counter(labels[step] for step in present)
            winner, votes = tally.most_common(1)[0]

            if votes * 2 <= len(present) or winner == NO_CHORD_LABEL:
                continue

            agreeing = [confidence[step] for step in present if labels[step] == winner]
            winner_confidence = sum(agreeing) / len(agreeing)

            for step in present:
                if labels[step] != winner and confidence[step] < winner_confidence:
                    changes[step] = (winner, winner_confidence)

    return changes


def rebuild(chords, grid, changes):
    rebuilt = []

    for step, index in enumerate(to_steps(chords, grid)):
        label, confidence = changes.get(step, (chords[index]["label"], chords[index]["confidence"]))
        length = grid[step + 1] - grid[step]

        if rebuilt and rebuilt[-1]["label"] == label:
            previous = rebuilt[-1]
            so_far = previous["end"] - previous["start"]
            previous["confidence"] = (previous["confidence"] * so_far + confidence * length) / (so_far + length)
            previous["end"] = grid[step + 1]
        else:
            rebuilt.append({"start": grid[step], "end": grid[step + 1], "label": label, "confidence": confidence})

    return rebuilt


def crosscheck_chords(chords, sections, parts, grid, use_flats):
    changes = []
    checked = []

    for chord in chords:
        better = check_third(chord, parts, use_flats) if parts else None

        if better:
            changes.append({"start": chord["start"], "end": chord["end"], "from": chord["label"], "to": better, "reason": "notes"})

        checked.append({**chord, "label": better or chord["label"]})

    votes = vote(checked, sections, grid)
    voted = rebuild(checked, grid, votes)

    for step, (label, _) in sorted(votes.items()):
        before = checked[to_steps(checked, grid)[step]]["label"]
        last = changes[-1] if changes else None

        if last and last["reason"] == "repeats" and last["to"] == label and last["from"] == before and abs(last["end"] - grid[step]) < 1e-6:
            last["end"] = grid[step + 1]
        else:
            changes.append({"start": grid[step], "end": grid[step + 1], "from": before, "to": label, "reason": "repeats"})

    finished = []

    for chord in voted:
        slash = check_bass(chord, parts, use_flats) if parts else None

        if slash:
            changes.append({"start": chord["start"], "end": chord["end"], "from": chord["label"], "to": slash, "reason": "bass"})

        finished.append({
            "start": round(float(chord["start"]), 3),
            "end": round(float(chord["end"]), 3),
            "label": slash or chord["label"],
            "confidence": round(float(chord["confidence"]), 3),
        })

    for change in changes:
        change["start"] = round(float(change["start"]), 3)
        change["end"] = round(float(change["end"]), 3)

    return finished, sorted(changes, key=lambda change: change["start"])
