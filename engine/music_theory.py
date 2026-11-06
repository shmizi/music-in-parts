SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]

MAJOR_KEY_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
MINOR_KEY_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"]

FLAT_MAJOR_TONICS = {1, 3, 5, 8, 10}
FLAT_MINOR_TONICS = {0, 2, 3, 5, 7, 10}

# semitone steps above the tonic for each scale
MAJOR_SCALE = (0, 2, 4, 5, 7, 9, 11)
MINOR_SCALE = (0, 2, 3, 5, 7, 8, 10)

# order the chord model uses for its 14 chord qualities
MODEL_QUALITIES = (
    "min", "maj", "dim", "aug", "min6", "maj6", "min7",
    "minmaj7", "maj7", "7", "dim7", "hdim7", "sus2", "sus4",
)

QUALITY_SUFFIXES = {
    "min": "m",
    "maj": "",
    "dim": "dim",
    "aug": "aug",
    "min6": "m6",
    "maj6": "6",
    "min7": "m7",
    "minmaj7": "mMaj7",
    "maj7": "maj7",
    "7": "7",
    "dim7": "dim7",
    "hdim7": "m7b5",
    "sus2": "sus2",
    "sus4": "sus4",
}

# semitone steps above the root for the notes of each chord quality
QUALITY_INTERVALS = {
    "min": (0, 3, 7),
    "maj": (0, 4, 7),
    "dim": (0, 3, 6),
    "aug": (0, 4, 8),
    "min6": (0, 3, 7, 9),
    "maj6": (0, 4, 7, 9),
    "min7": (0, 3, 7, 10),
    "minmaj7": (0, 3, 7, 11),
    "maj7": (0, 4, 7, 11),
    "7": (0, 4, 7, 10),
    "dim7": (0, 3, 6, 9),
    "hdim7": (0, 3, 6, 10),
    "sus2": (0, 2, 7),
    "sus4": (0, 5, 7),
}

NO_CHORD_INDEX = 169
UNKNOWN_CHORD_INDEX = 168
NO_CHORD_LABEL = "N"


def key_uses_flats(tonic, mode):
    if mode == "major":
        return tonic in FLAT_MAJOR_TONICS

    return tonic in FLAT_MINOR_TONICS


def key_name(tonic, mode):
    names = MAJOR_KEY_NAMES if mode == "major" else MINOR_KEY_NAMES
    return f"{names[tonic]} {mode}"


def note_name(pitch_class, use_flats):
    names = FLAT_NAMES if use_flats else SHARP_NAMES
    return names[pitch_class]


def split_chord_index(index):
    if index >= UNKNOWN_CHORD_INDEX:
        return None, None

    return index // len(MODEL_QUALITIES), MODEL_QUALITIES[index % len(MODEL_QUALITIES)]


def chord_label(index, use_flats):
    root, quality = split_chord_index(index)

    if root is None:
        return NO_CHORD_LABEL

    return note_name(root, use_flats) + QUALITY_SUFFIXES[quality]


def chord_pitch_classes(index):
    root, quality = split_chord_index(index)

    if root is None:
        return ()

    return tuple((root + interval) % 12 for interval in QUALITY_INTERVALS[quality])
