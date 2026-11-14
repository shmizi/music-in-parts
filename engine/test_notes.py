import unittest

import numpy as np

import notes


def tone(frequency, seconds, rate=44100, level=0.3):
    times = np.arange(int(seconds * rate)) / rate
    return (level * np.sin(2 * np.pi * frequency * times)).astype(np.float32)


class SingleLineTests(unittest.TestCase):
    def test_the_louder_of_two_overlapping_notes_wins(self):
        kept = notes.keep_single_line([[0.0, 1.0, 60, 0.5], [0.5, 1.5, 72, 0.9]])

        self.assertEqual([note[2] for note in kept], [60, 72])
        self.assertEqual(kept[0][1], 0.5)

    def test_a_quieter_overlapping_note_is_dropped(self):
        kept = notes.keep_single_line([[0.0, 1.0, 60, 0.9], [0.2, 0.4, 72, 0.3]])

        self.assertEqual([note[2] for note in kept], [60])

    def test_quiet_and_tiny_notes_are_cleaned_away(self):
        events = [(0.0, 0.5, 60, 0.9, None), (1.0, 1.02, 62, 0.9, None), (2.0, 2.5, 64, 0.05, None)]

        self.assertEqual([note[2] for note in notes.clean_notes(events, False)], [60])


class SoloTests(unittest.TestCase):
    def build_song(self):
        rate = 44100
        bar = 2.0
        bars = 12
        silence = np.zeros(int(bar * bars * rate), dtype=np.float32)
        stems = {name: silence.copy() for name in ("guitar", "piano", "other", "vocals")}
        notes_by_stem = {"guitar": [], "other": []}

        for index in range(bars):
            start = int(index * bar * rate)
            stems["other"][start:start + int(bar * rate)] = tone(220, bar, level=0.05)

            if 4 <= index < 8:
                for step in range(8):
                    pitch = [69, 72, 74, 76][step % 4]
                    begin = index * bar + step * 0.25
                    notes_by_stem["guitar"].append([begin, begin + 0.2, pitch, 0.8])
                    first = int(begin * rate)
                    stems["guitar"][first:first + int(0.2 * rate)] = tone(440 * 2 ** ((pitch - 69) / 12), 0.2)
            else:
                stems["vocals"][start:start + int(bar * rate)] = tone(300, bar)

            notes_by_stem["other"].append([index * bar, index * bar + bar, 57, 0.8])

        analysis = {"downbeats": [index * bar for index in range(1, bars)]}

        return stems, notes_by_stem, rate, analysis, bar * bars

    def test_a_guitar_solo_between_sung_parts_is_found(self):
        solos = notes.find_solos(*self.build_song())

        self.assertEqual(len(solos), 1)
        self.assertEqual(solos[0]["stem"], "guitar")
        self.assertEqual(solos[0]["label"], "Guitar solo")
        self.assertAlmostEqual(solos[0]["start"], 8.0)
        self.assertAlmostEqual(solos[0]["end"], 16.0)
        self.assertEqual(len(solos[0]["notes"]), 32)

    def test_no_solo_when_someone_is_singing(self):
        stems, notes_by_stem, rate, analysis, duration = self.build_song()
        stems["vocals"][:] = tone(300, duration)

        self.assertEqual(notes.find_solos(stems, notes_by_stem, rate, analysis, duration), [])

    def test_windows_fall_back_to_fixed_lengths(self):
        edges = notes.window_edges(None, 5.0)

        self.assertEqual(edges[0], 0.0)
        self.assertEqual(edges[-1], 5.0)
        self.assertEqual(len(edges), 4)


if __name__ == "__main__":
    unittest.main()
