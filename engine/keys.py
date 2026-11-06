import numpy as np

from music_theory import (
    MAJOR_SCALE,
    MINOR_SCALE,
    chord_pitch_classes,
    key_name,
    key_uses_flats,
    note_name,
)


# Krumhansl-Kessler weights: how strongly each scale step suggests a key
MAJOR_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR_PROFILE = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

# how much the chords count next to the overall note content
CHORD_WEIGHT = 0.5

# notes at least this strong, relative to the strongest, count as main notes
MAIN_NOTE_LIMIT = 0.35

# a scale has about seven notes, so listing more than this stops being useful
MAXIMUM_MAIN_NOTES = 7


def profile_scores(chroma_mean):
    scores = np.zeros((2, 12))

    for tonic in range(12):
        scores[0, tonic] = np.corrcoef(chroma_mean, np.roll(MAJOR_PROFILE, tonic))[0, 1]
        scores[1, tonic] = np.corrcoef(chroma_mean, np.roll(MINOR_PROFILE, tonic))[0, 1]

    return np.nan_to_num(scores)


def chord_scores(segments):
    scores = np.zeros((2, 12))
    total = sum(segment["end"] - segment["start"] for segment in segments)

    if total <= 0:
        return scores

    for mode, scale in enumerate((MAJOR_SCALE, MINOR_SCALE)):
        for tonic in range(12):
            notes_in_key = {(tonic + step) % 12 for step in scale}

            # tonic_triad: the chord a song in this key usually rests on
            third = 4 if mode == 0 else 3
            tonic_triad = {tonic, (tonic + third) % 12, (tonic + 7) % 12}

            score = 0.0

            for segment in segments:
                tones = set(chord_pitch_classes(segment["index"]))

                if not tones:
                    continue

                seconds = segment["end"] - segment["start"]
                in_key = len(tones & notes_in_key) / len(tones)
                is_tonic = tonic_triad <= tones

                score += seconds * (in_key + (0.5 if is_tonic else 0.0))

            scores[mode, tonic] = score / total

    return scores


def relative_key(mode, tonic):
    if mode == 0:
        return 1, (tonic + 9) % 12

    return 0, (tonic + 3) % 12


def find_key(chroma_mean, segments):
    scores = profile_scores(chroma_mean) + CHORD_WEIGHT * chord_scores(segments)

    best_mode, best_tonic = np.unravel_index(np.argmax(scores), scores.shape)
    best_mode, best_tonic = int(best_mode), int(best_tonic)
    best_score = scores[best_mode, best_tonic]

    relative = relative_key(best_mode, best_tonic)

    # rivals: every other key, leaving out the relative key, which shares the same notes
    rivals = scores.copy()
    rivals[best_mode, best_tonic] = -np.inf
    rivals[relative] = -np.inf

    margin = float(best_score - rivals.max())
    relative_margin = float(best_score - scores[relative])

    mode_name = "major" if best_mode == 0 else "minor"
    relative_name = "major" if relative[0] == 0 else "minor"

    return {
        "tonic": best_tonic,
        "mode": mode_name,
        "name": key_name(best_tonic, mode_name),
        "alternative": key_name(relative[1], relative_name),
        "useFlats": key_uses_flats(best_tonic, mode_name),
        "confidence": round(float(np.clip(min(margin * 2.5, 0.5 + relative_margin * 5.0), 0.0, 1.0)), 2),
    }


def find_main_notes(chroma_mean, use_flats):
    strongest = chroma_mean.max()

    if strongest <= 0:
        return []

    ranked = np.argsort(chroma_mean)[::-1]

    main_notes = [
        note_name(int(pitch_class), use_flats)
        for pitch_class in ranked
        if chroma_mean[pitch_class] >= MAIN_NOTE_LIMIT * strongest
    ]

    return main_notes[:MAXIMUM_MAIN_NOTES]
