import unittest

import numpy as np

import lyrics
import romanize


def word(text, start, end):
    return {"text": text, "start": start, "end": end, "confidence": 0.9}


class KoreanTests(unittest.TestCase):
    def test_syllables(self):
        self.assertEqual(romanize.romanize_korean("한국"), "Hanguk")
        self.assertEqual(romanize.romanize_korean("노래"), "Norae")

    def test_final_consonant_moves_before_a_silent_start(self):
        self.assertEqual(romanize.romanize_korean("오늘은"), "Oneureun")
        self.assertEqual(romanize.romanize_korean("사랑해요"), "Saranghaeyo")

    def test_double_l(self):
        self.assertEqual(romanize.romanize_korean("불러요"), "Bulleoyo")

    def test_spaces_and_other_text_are_kept(self):
        self.assertEqual(romanize.romanize_korean("같이 노래 OK!"), "Gati norae OK!")


class HindiTests(unittest.TestCase):
    def test_final_vowel_is_dropped_after_a_consonant(self):
        self.assertEqual(romanize.romanize_hindi("बहुत"), "Bahut")
        self.assertEqual(romanize.romanize_hindi("साथ"), "Saath")

    def test_single_letter_words_keep_their_vowel(self):
        self.assertEqual(romanize.romanize_hindi("न"), "Na")

    def test_plain_spellings(self):
        self.assertEqual(romanize.romanize_hindi("आज मौसम बहुत अच्छा है।"), "Aaj mausam bahut achchhaa hai.")
        self.assertEqual(romanize.romanize_hindi("चलो"), "Chalo")


class JapaneseTests(unittest.TestCase):
    def test_romaji(self):
        self.assertEqual(romanize.romanize_line("今日はいい天気ですね", "ja"), "Kyou wa ii tenki desu ne")


class LanguageTests(unittest.TestCase):
    def test_urdu_guess_is_shown_as_hindi(self):
        code, detected = lyrics.choose_language({"ur": 0.6, "hi": 0.3, "en": 0.1})

        self.assertEqual(code, "hi")
        self.assertEqual(detected[0]["code"], "ur")

    def test_filipino_name(self):
        self.assertEqual(lyrics.language_name("tl"), "Filipino (Tagalog)")
        self.assertEqual(lyrics.language_name("ko"), "Korean")

    def test_only_some_languages_get_romanised(self):
        self.assertIsNone(romanize.romanize_line("hola", "es"))


class SingingRegionTests(unittest.TestCase):
    def test_finds_singing_between_silence(self):
        rate = lyrics.WHISPER_RATE
        signal = np.zeros(rate * 10, dtype=np.float32)
        times = np.arange(rate * 2) / rate
        signal[rate * 3:rate * 5] = 0.3 * np.sin(2 * np.pi * 220 * times)

        regions = lyrics.singing_regions(signal)

        self.assertEqual(len(regions), 1)
        self.assertAlmostEqual(regions[0][0], 3.0 - lyrics.REGION_PADDING, delta=0.1)
        self.assertAlmostEqual(regions[0][1], 5.0 + lyrics.REGION_PADDING, delta=0.1)

    def test_silence_has_no_singing(self):
        self.assertEqual(lyrics.singing_regions(np.zeros(lyrics.WHISPER_RATE * 5, dtype=np.float32)), [])

    def test_short_pauses_are_bridged(self):
        rate = lyrics.WHISPER_RATE
        signal = np.zeros(rate * 10, dtype=np.float32)
        times = np.arange(rate * 2) / rate
        burst = 0.3 * np.sin(2 * np.pi * 220 * times)
        signal[rate * 2:rate * 4] = burst
        signal[int(rate * 4.5):int(rate * 6.5)] = burst

        self.assertEqual(len(lyrics.singing_regions(signal)), 1)


class LineTests(unittest.TestCase):
    def test_pauses_start_new_lines(self):
        words = [word(" hello", 0.0, 0.4), word(" there", 0.5, 0.9), word(" again", 3.0, 3.4)]
        lines = lyrics.build_lines(words, "en")

        self.assertEqual([line["text"] for line in lines], ["hello there", " again".strip()])
        self.assertEqual(lines[0]["start"], 0.0)
        self.assertEqual(lines[0]["end"], 0.9)

    def test_long_lines_split_at_the_biggest_pause(self):
        words = [word(f" word{index}", index * 0.5, index * 0.5 + 0.4) for index in range(14)]
        words[7]["start"] += 0.3
        words[7]["end"] += 0.3

        lines = lyrics.build_lines(words, "en")

        self.assertEqual(len(lines), 2)
        self.assertTrue(lines[1]["text"].startswith("word7"))

    def test_unspaced_text_keeps_no_spaces(self):
        words = [word("今日", 0.0, 0.4), word("は", 0.4, 0.6), word("いい", 0.6, 0.9)]
        line = lyrics.build_lines(words, "ja")[0]

        self.assertEqual(line["text"], "今日はいい")
        self.assertEqual(line["romanized"], "Kyou wa ii")

    def test_words_outside_singing_are_dropped(self):
        result = {"segments": [{"words": [
            {"word": " real", "start": 1.0, "end": 1.4, "probability": 0.9},
            {"word": " ghost", "start": 8.0, "end": 8.4, "probability": 0.9},
        ]}]}

        words = lyrics.collect_words(result, [(0.5, 2.0)])

        self.assertEqual([item["text"] for item in words], [" real"])


class PasteTests(unittest.TestCase):
    def heard(self, texts, step=0.5):
        words = [word((" " if index else "") + text, index * step, index * step + 0.4) for index, text in enumerate(texts)]
        return [{"words": words}]

    def test_pasted_words_take_the_sung_times(self):
        heard = self.heard(["hello", "there", "my", "friend"])
        lines = lyrics.align_pasted("Hello there,\nmy friend!", heard, "en")

        self.assertEqual([line["text"] for line in lines], ["Hello there,", "my friend!"])
        self.assertEqual(lines[1]["start"], 1.0)
        self.assertFalse(any(item["estimated"] for line in lines for item in line["words"]))

    def test_misheard_words_are_corrected_and_timed_between_neighbours(self):
        heard = self.heard(["hello", "dare", "my", "friend"])
        lines = lyrics.align_pasted("hello there my friend", heard, "en")
        words = lines[0]["words"]

        self.assertEqual(words[1]["text"], " there")
        self.assertGreaterEqual(words[1]["start"], words[0]["end"] - 0.01)
        self.assertLessEqual(words[1]["end"], words[2]["start"] + 0.01)

    def test_section_labels_and_chord_lines_are_skipped(self):
        heard = self.heard(["la", "la"])
        text = "[Chorus]\nAm   F   C   G\nla la\nVerse 2:"

        lines = lyrics.align_pasted(text, heard, "en")

        self.assertEqual([line["text"] for line in lines], ["la la"])

    def test_japanese_is_matched_character_by_character(self):
        heard = [{"words": [word("今日", 0.0, 1.0), word("はいい", 1.0, 2.5)]}]
        lines = lyrics.align_pasted("今日は いい", heard, "ja")

        self.assertEqual(lines[0]["text"], "今日は いい")
        self.assertAlmostEqual(lines[0]["start"], 0.0)
        self.assertAlmostEqual(lines[0]["end"], 2.5)
        self.assertEqual(lines[0]["romanized"], "Kyou wa ii")

    def test_nothing_to_paste(self):
        with self.assertRaises(RuntimeError):
            lyrics.align_pasted("[Intro]\n\n", self.heard(["la"]), "en")


if __name__ == "__main__":
    unittest.main()
