import unittest

import chord_crosscheck
import lyric_sections
import refine


BAR = 2.0


def sung(text, start, confidence=0.9):
    # one word every half second, starting at start
    return [
        {"text": (" " if index else "") + piece, "start": start + index * 0.5, "end": start + index * 0.5 + 0.4, "confidence": confidence}
        for index, piece in enumerate(text.split())
    ]


def line(text, start, confidence=0.9):
    words = sung(text, start, confidence)
    return {"start": words[0]["start"], "end": words[-1]["end"], "text": text, "words": words}


def song_analysis(bars):
    duration = bars * BAR

    return {
        "beats": [round(index * BAR / 4, 3) for index in range(bars * 4)],
        "downbeats": [index * BAR for index in range(bars)],
        "sections": [{"start": 0.0, "end": duration, "label": "Song"}],
        "key": {"useFlats": False},
        "chords": [],
    }


VERSE_ONE = ["walking down the empty street tonight", "nobody knows the things that we have seen", "counting every window on the way", "pockets full of nothing but the rain"]
VERSE_TWO = ["morning comes too early for the tired", "coffee getting colder on the table", "letters that I never meant to send", "shadows growing longer down the hall"]
CHORUS = ["hold on to the feeling that you know", "never let the daylight slip away", "hold on to the feeling that you know", "never let the daylight slip away"]


def song_lyrics():
    # 4 bars of intro, then verse, chorus, verse, chorus, each 8 bars, then 4 bars of outro
    lines = []

    for block, start_bar in ((VERSE_ONE, 4), (CHORUS, 12), (VERSE_TWO, 20), (CHORUS, 28)):
        for index, text in enumerate(block):
            lines.append(line(text, (start_bar + index * 2) * BAR + 0.1))

    return {"lines": lines}


class LyricSectionTests(unittest.TestCase):
    def test_words_that_come_back_later_are_repeated(self):
        words = lyric_sections.flatten_words(song_lyrics())
        repeated = lyric_sections.repeated_words(words)
        by_time = {word["start"]: flag for word, flag in zip(words, repeated)}

        self.assertFalse(by_time[4 * BAR + 0.1])
        self.assertTrue(by_time[12 * BAR + 0.1])
        self.assertTrue(by_time[28 * BAR + 0.1])

    def test_a_line_sung_twice_in_a_row_is_not_a_chorus(self):
        lyrics = {"lines": [line("the same words again and again", 0.0), line("the same words again and again", 4.0)]}
        words = lyric_sections.flatten_words(lyrics)

        self.assertFalse(any(lyric_sections.repeated_words(words)))

    def test_sections_are_named_from_the_lyrics(self):
        sections = lyric_sections.sections_from_lyrics(song_analysis(40), song_lyrics(), None)

        self.assertEqual(
            [section["label"] for section in sections],
            ["Intro", "Verse 1", "Chorus 1", "Verse 2", "Chorus 2", "Outro"],
        )
        self.assertEqual([section["start"] for section in sections], [0.0, 8.0, 24.0, 40.0, 56.0, 72.0])
        self.assertEqual(sections[-1]["end"], 80.0)

    def test_misheard_words_do_not_hide_a_chorus(self):
        lyrics = song_lyrics()

        # half of the second chorus is misheard, and the model wasn't sure of those words
        lyrics["lines"] = lyrics["lines"][:12] + [
            line("hold on to the feeling that you know", 28 * BAR + 0.1),
            line("heaven led a tailor chip a bay", 30 * BAR + 0.1, confidence=0.3),
            line("golden two the ceiling fat shoe no", 32 * BAR + 0.1, confidence=0.3),
            line("never let the daylight slip away", 34 * BAR + 0.1),
        ]

        sections = lyric_sections.sections_from_lyrics(song_analysis(40), lyrics, None)

        self.assertEqual(sections[4], {"start": 56.0, "end": 72.0, "label": "Chorus 2"})

    def test_an_instrumental_break_is_named_after_its_solo(self):
        lyrics = song_lyrics()
        lyrics["lines"] = [item for item in lyrics["lines"] if not 40.0 <= item["start"] < 56.0]
        notes = {"solos": [{"start": 40.0, "end": 56.0, "label": "Guitar solo"}]}

        sections = lyric_sections.sections_from_lyrics(song_analysis(40), lyrics, notes)

        self.assertEqual(
            [section["label"] for section in sections],
            ["Intro", "Verse", "Chorus 1", "Guitar Solo", "Chorus 2", "Outro"],
        )

    def test_songs_without_a_repeating_chorus_are_left_alone(self):
        lyrics = {"lines": [line(text, 8.0 + index * 4.0) for index, text in enumerate(VERSE_ONE + VERSE_TWO)]}

        self.assertIsNone(lyric_sections.sections_from_lyrics(song_analysis(40), lyrics, None))

    def test_too_few_words_are_left_alone(self):
        self.assertIsNone(lyric_sections.sections_from_lyrics(song_analysis(40), {"lines": [line("la la la", 4.0)]}, None))

    def test_unspaced_languages_are_matched_on_shorter_runs(self):
        def unspaced(text, start):
            words = [{"text": character, "start": start + index * 0.3, "end": start + index * 0.3 + 0.25, "confidence": 0.9} for index, character in enumerate(text)]
            return {"start": start, "end": words[-1]["end"], "text": text, "words": words}

        lyrics = {"lines": [unspaced("今日はいい天気", 0.0), unspaced("明日もきっと晴れる", 5.0), unspaced("今日はいい天気", 30.0)]}
        words = lyric_sections.flatten_words(lyrics)
        repeated = lyric_sections.repeated_words(words)

        self.assertTrue(all(repeated[:7]))
        self.assertFalse(any(repeated[7:16]))


def chord(label, start, end, confidence=0.8):
    return {"start": start, "end": end, "label": label, "confidence": confidence}


def held(pitches, start, end, loudness=0.8):
    return [[start, end, pitch, loudness] for pitch in pitches]


class NotesAgainstChordsTests(unittest.TestCase):
    def test_a_clear_minor_third_turns_a_major_chord_minor(self):
        parts = {"guitar": {"notes": held([50, 53, 57], 0.0, 2.0)}}

        self.assertEqual(chord_crosscheck.check_third(chord("D", 0.0, 2.0), parts, False), "Dm")
        self.assertEqual(chord_crosscheck.check_third(chord("D7", 0.0, 2.0), parts, False), "Dm7")

    def test_matching_notes_change_nothing(self):
        parts = {"piano": {"notes": held([50, 54, 57], 0.0, 2.0)}}

        self.assertIsNone(chord_crosscheck.check_third(chord("D", 0.0, 2.0), parts, False))

    def test_both_thirds_together_change_nothing(self):
        parts = {"guitar": {"notes": held([50, 53, 54, 57], 0.0, 2.0)}}

        self.assertIsNone(chord_crosscheck.check_third(chord("D", 0.0, 2.0), parts, False))

    def test_minor_to_major_needs_more_proof(self):
        faint = {"guitar": {"notes": held([50, 57], 0.0, 2.0) + held([53], 0.0, 0.5) + held([54], 0.0, 2.0)}}
        clear = {"guitar": {"notes": held([50, 54, 57], 0.0, 2.0)}}

        self.assertIsNone(chord_crosscheck.check_third(chord("Dm", 0.0, 2.0), faint, False))
        self.assertEqual(chord_crosscheck.check_third(chord("Dm", 0.0, 2.0), clear, False), "D")

    def test_brief_or_quiet_chords_are_left_alone(self):
        parts = {"guitar": {"notes": held([50, 53, 57], 0.0, 2.0)}}
        quiet = {"guitar": {"notes": held([50, 53, 57], 0.0, 2.0, loudness=0.05)}}

        self.assertIsNone(chord_crosscheck.check_third(chord("D", 0.0, 0.5), parts, False))
        self.assertIsNone(chord_crosscheck.check_third(chord("D", 0.0, 2.0), quiet, False))

    def test_a_melody_note_in_the_singing_counts_for_less(self):
        parts = {"guitar": {"notes": held([50, 54, 57], 0.0, 2.0)}, "vocals": {"notes": held([65], 0.0, 2.0)}}

        self.assertIsNone(chord_crosscheck.check_third(chord("D", 0.0, 2.0), parts, False))

    def test_the_bass_on_another_chord_note_makes_a_slash_chord(self):
        parts = {"bass": {"notes": held([42], 0.0, 2.0)}}

        self.assertEqual(chord_crosscheck.check_bass(chord("D", 0.0, 2.0), parts, False), "D/F#")

    def test_the_bass_note_is_spelled_like_its_chord(self):
        parts = {"bass": {"notes": held([42], 0.0, 2.0) + held([41], 2.0, 4.0)}}

        self.assertEqual(chord_crosscheck.check_bass(chord("B", 0.0, 2.0), parts, True), "B/F#")
        self.assertEqual(chord_crosscheck.check_bass(chord("Bb", 2.0, 4.0), parts, False), "Bb/F")

    def test_a_walking_bass_or_the_root_makes_no_slash_chord(self):
        walking = {"bass": {"notes": held([38], 0.0, 0.5) + held([42], 0.5, 1.0) + held([45], 1.0, 1.5) + held([42], 1.5, 2.0)}}
        root = {"bass": {"notes": held([38], 0.0, 2.0)}}
        outside = {"bass": {"notes": held([39], 0.0, 2.0)}}

        for parts in (walking, root, outside, {}):
            self.assertIsNone(chord_crosscheck.check_bass(chord("D", 0.0, 2.0), parts, False))


def label_at(chords, seconds):
    return next(item["label"] for item in chords if item["start"] <= seconds < item["end"])


def progression(labels, start):
    return [chord(label, start + index * 2.0, start + index * 2.0 + 2.0) for index, label in enumerate(labels)]


class RepeatedSectionTests(unittest.TestCase):
    def setUp(self):
        self.grid = [index * 0.5 for index in range(97)]
        self.sections = [
            {"start": 0.0, "end": 16.0, "label": "Chorus 1"},
            {"start": 16.0, "end": 32.0, "label": "Chorus 2"},
            {"start": 32.0, "end": 48.0, "label": "Chorus 3"},
        ]

    def chords(self, third_copy):
        pattern = ["C", "G", "Am", "F", "C", "G", "F", "C"]
        return progression(pattern, 0.0) + progression(pattern, 16.0) + third_copy

    def test_the_odd_copy_out_is_outvoted(self):
        odd = progression(["C", "G", "A", "F", "C", "G", "F", "C"], 32.0)
        odd[2]["confidence"] = 0.4

        finished, changes = chord_crosscheck.crosscheck_chords(self.chords(odd), self.sections, {}, self.grid, False)

        self.assertEqual(label_at(finished, 37.0), "Am")
        self.assertEqual(label_at(finished, 35.0), "G")
        self.assertEqual(changes, [{"start": 36.0, "end": 38.0, "from": "A", "to": "Am", "reason": "repeats"}])

    def test_a_confident_odd_copy_is_kept(self):
        odd = progression(["C", "G", "A", "F", "C", "G", "F", "C"], 32.0)
        odd[2]["confidence"] = 0.95

        finished, changes = chord_crosscheck.crosscheck_chords(self.chords(odd), self.sections, {}, self.grid, False)

        self.assertEqual(label_at(finished, 37.0), "A")
        self.assertEqual(changes, [])

    def test_a_copy_with_other_chords_takes_no_part(self):
        other = progression(["Dm", "Bb", "Gm", "A", "Dm", "Bb", "A", "Dm"], 32.0)

        for item in other:
            item["confidence"] = 0.3

        _, changes = chord_crosscheck.crosscheck_chords(self.chords(other), self.sections, {}, self.grid, False)

        self.assertEqual(changes, [])

    def test_a_copy_that_starts_a_bar_late_is_lined_up_first(self):
        late = [chord("F", 32.0, 34.0, 0.9)] + progression(["C", "G", "A", "F", "C", "G", "F"], 34.0)
        late[3]["confidence"] = 0.4
        sections = [*self.sections[:2], {"start": 34.0, "end": 48.0, "label": "Chorus 3"}]

        _, changes = chord_crosscheck.crosscheck_chords(self.chords(late), sections, {}, self.grid, False)

        self.assertEqual(changes, [{"start": 38.0, "end": 40.0, "from": "A", "to": "Am", "reason": "repeats"}])

    def test_two_copies_are_not_enough_to_vote(self):
        chords = progression(["C", "G", "Am", "F"], 0.0) + progression(["C", "G", "A", "F"], 8.0)
        sections = [{"start": 0.0, "end": 8.0, "label": "Verse 1"}, {"start": 8.0, "end": 16.0, "label": "Verse 2"}]

        _, changes = chord_crosscheck.crosscheck_chords(chords, sections, {}, self.grid[:33], False)

        self.assertEqual(changes, [])


class RefineTests(unittest.TestCase):
    def test_refining_twice_gives_the_same_answer(self):
        analysis = song_analysis(40)
        analysis["chords"] = progression(["D", "G", "A", "D"] * 10, 0.0)
        notes = {"parts": {"guitar": {"notes": held([50, 53, 57], 0.0, 2.0)}}, "solos": []}

        once = refine.refine(analysis, song_lyrics(), notes)
        twice = refine.refine(once, song_lyrics(), notes)

        self.assertEqual(once, twice)
        self.assertEqual(once["chords"][0]["label"], "Dm")
        self.assertEqual(once["firstPass"]["chords"][0]["label"], "D")
        self.assertEqual(once["crossChecks"]["sections"], "lyrics")
        self.assertEqual(once["sections"][2]["label"], "Chorus 1")

    def test_a_song_with_no_lyrics_or_notes_keeps_its_sections(self):
        analysis = song_analysis(40)
        analysis["chords"] = progression(["D", "G"], 0.0)

        refined = refine.refine(analysis, None, None)

        self.assertEqual(refined["sections"], analysis["sections"])
        self.assertEqual(refined["crossChecks"], {"sections": "sound", "chordChanges": []})


if __name__ == "__main__":
    unittest.main()
