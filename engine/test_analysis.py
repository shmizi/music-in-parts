import unittest

import numpy as np

import beats
import chords
import evidence
import keys
import music_theory
import sections


def chord_index(root, quality):
    return root * len(music_theory.MODEL_QUALITIES) + music_theory.MODEL_QUALITIES.index(quality)


def segment(start, end, index):
    return {"start": start, "end": end, "index": index, "confidence": 0.9}


class MusicTheoryTests(unittest.TestCase):
    def test_labels_follow_the_key_spelling(self):
        a_flat_major = chord_index(8, "maj")

        self.assertEqual(music_theory.chord_label(a_flat_major, True), "Ab")
        self.assertEqual(music_theory.chord_label(a_flat_major, False), "G#")

    def test_label_suffixes(self):
        self.assertEqual(music_theory.chord_label(chord_index(9, "min"), False), "Am")
        self.assertEqual(music_theory.chord_label(chord_index(0, "maj7"), False), "Cmaj7")
        self.assertEqual(music_theory.chord_label(chord_index(11, "hdim7"), False), "Bm7b5")

    def test_no_chord(self):
        self.assertEqual(music_theory.chord_label(music_theory.NO_CHORD_INDEX, False), "N")
        self.assertEqual(music_theory.chord_pitch_classes(music_theory.UNKNOWN_CHORD_INDEX), ())

    def test_chord_notes(self):
        self.assertEqual(music_theory.chord_pitch_classes(chord_index(9, "min")), (9, 0, 4))


class ViterbiTests(unittest.TestCase):
    def test_a_short_blip_is_smoothed_away(self):
        probabilities = np.full((9, 4), 0.02)
        probabilities[:, 0] = 0.9
        probabilities[4, 0] = 0.3
        probabilities[4, 1] = 0.6

        self.assertEqual(chords.viterbi(probabilities).tolist(), [0] * 9)

    def test_a_lasting_change_is_kept(self):
        probabilities = np.full((10, 4), 0.02)
        probabilities[:5, 0] = 0.9
        probabilities[5:, 2] = 0.9

        self.assertEqual(chords.viterbi(probabilities).tolist(), [0] * 5 + [2] * 5)


class EvidenceTests(unittest.TestCase):
    def tone(self, frequency, seconds=2.0):
        times = np.arange(int(seconds * evidence.SAMPLE_RATE)) / evidence.SAMPLE_RATE
        return np.sin(2 * np.pi * frequency * times).astype(np.float32)

    def test_a_note_shows_up_under_its_name(self):
        grid = np.array([0.5, 1.0, 1.5])
        levels = evidence.note_levels(self.tone(440.0), grid)

        self.assertEqual(levels.shape, (2, 12))
        self.assertEqual(int(np.argmax(levels[0])), 9)

    def test_notes_under_the_lowest_note_are_ignored(self):
        grid = np.array([0.5, 1.5])
        low = self.tone(55.0) * 0.9 + self.tone(440.0 * 2 ** (3 / 12)) * 0.1

        self.assertEqual(int(np.argmax(evidence.note_levels(low, grid)[0])), 0)

    def test_the_bass_is_only_used_when_nothing_else_is_playing(self):
        upper = self.tone(440.0)
        full = upper + self.tone(55.0)
        silent = np.zeros_like(upper)

        self.assertIs(evidence.choose_signal(upper, full), upper)
        self.assertIs(evidence.choose_signal(silent, full), full)


class TempoTests(unittest.TestCase):
    def test_steady_beats(self):
        beat_times = np.arange(0, 60, 0.5)
        tempo = beats.summarise_tempo(beat_times, beat_times[::4])

        self.assertEqual(tempo["bpm"], 120.0)
        self.assertEqual(tempo["beatsPerBar"], 4)
        self.assertTrue(tempo["steady"])

    def test_three_beats_per_bar(self):
        beat_times = np.arange(0, 60, 0.5)

        self.assertEqual(beats.summarise_tempo(beat_times, beat_times[::3])["beatsPerBar"], 3)

    def test_drifting_beats(self):
        lengths = np.random.default_rng(1).uniform(0.3, 0.7, 100)
        tempo = beats.summarise_tempo(np.cumsum(lengths), np.array([]))

        self.assertFalse(tempo["steady"])

    def test_too_few_beats(self):
        self.assertIsNone(beats.summarise_tempo(np.array([1.0, 2.0]), np.array([]))["bpm"])


class KeyTests(unittest.TestCase):
    def test_a_minor_progression(self):
        chroma = np.zeros(12)

        for note, weight in {9: 1.0, 0: 0.7, 4: 0.8, 5: 0.5, 7: 0.5, 2: 0.3, 11: 0.3}.items():
            chroma[note] = weight

        progression = [
            segment(0, 8, chord_index(9, "min")),
            segment(8, 12, chord_index(5, "maj")),
            segment(12, 16, chord_index(0, "maj")),
            segment(16, 20, chord_index(7, "maj")),
            segment(20, 28, chord_index(9, "min")),
        ]

        key = keys.find_key(chroma, progression)

        self.assertEqual(key["name"], "A minor")
        self.assertEqual(key["alternative"], "C major")

    def test_main_notes_are_strongest_first_and_limited(self):
        chroma = np.array([1.0, 0.9, 0.8, 0.7, 0.6, 0.55, 0.5, 0.45, 0.4, 0.1, 0.1, 0.1])
        notes = keys.find_main_notes(chroma, False)

        self.assertEqual(notes[0], "C")
        self.assertEqual(len(notes), keys.MAXIMUM_MAIN_NOTES)


class SectionTests(unittest.TestCase):
    def test_a_clear_change_is_found(self):
        similarity = np.ones((32, 32))
        similarity[:16, 16:] = 0.0
        similarity[16:, :16] = 0.0

        self.assertEqual(sections.pick_boundaries(sections.novelty_curve(similarity)), [16])

    def test_matching_parts_share_a_cluster(self):
        similarity = np.full((24, 24), 0.2)

        for first, second in ((0, 12), (12, 0), (6, 18), (18, 6), (0, 0), (6, 6), (12, 12), (18, 18)):
            similarity[first:first + 6, second:second + 6] = 1.0

        parts = [(0, 6), (6, 12), (12, 18), (18, 24)]
        clusters = sections.cluster_segments(parts, similarity)

        self.assertEqual(clusters[0], clusters[2])
        self.assertEqual(clusters[1], clusters[3])
        self.assertNotEqual(clusters[0], clusters[1])

    def test_names_for_a_common_song_shape(self):
        runs = [
            {"start": 0, "end": 10, "cluster": 1},
            {"start": 10, "end": 40, "cluster": 2},
            {"start": 40, "end": 70, "cluster": 3},
            {"start": 70, "end": 100, "cluster": 2},
            {"start": 100, "end": 130, "cluster": 3},
            {"start": 130, "end": 150, "cluster": 4},
            {"start": 150, "end": 180, "cluster": 3},
            {"start": 180, "end": 190, "cluster": 5},
        ]

        loudness = [0.1, 0.2, 0.5, 0.2, 0.5, 0.3, 0.5, 0.1]
        labels = [item["label"] for item in sections.name_sections(runs, loudness)]

        self.assertEqual(
            labels,
            ["Intro", "Verse 1", "Chorus 1", "Verse 2", "Chorus 2", "Bridge", "Chorus 3", "Outro"],
        )

    def test_short_audio_is_one_section(self):
        result = sections.find_sections(np.zeros(22050), np.array([0.5, 1.0]), np.array([]), 10.0)

        self.assertEqual(result, [{"start": 0.0, "end": 10.0, "label": "Song"}])


if __name__ == "__main__":
    unittest.main()
