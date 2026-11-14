import unicodedata

from indic_transliteration import sanscript


ROMANIZED_LANGUAGES = {"hi", "ja", "ko"}

HANGUL_FIRST = 0xAC00
HANGUL_LAST = 0xD7A3
MEDIAL_COUNT = 21
FINAL_COUNT = 28

# Revised Romanization of Korean, in the order Unicode stores each part of a syllable
INITIALS = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"]
MEDIALS = [
    "a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae",
    "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i",
]
FINALS = [
    "", "k", "k", "k", "n", "n", "n", "t", "l", "k", "m", "l", "l", "l",
    "p", "l", "m", "p", "p", "t", "t", "ng", "t", "t", "k", "t", "p", "t",
]

# when the next syllable starts with a silent ㅇ, the final consonant moves across:
# what stays behind, and how the moved sound is written
LIAISON = {
    1: ("", "g"), 2: ("", "kk"), 3: ("k", "s"), 4: ("", "n"), 5: ("n", "j"), 6: ("n", ""),
    7: ("", "d"), 8: ("", "r"), 9: ("l", "g"), 10: ("l", "m"), 11: ("l", "b"), 12: ("l", "s"),
    13: ("l", "t"), 14: ("l", "p"), 15: ("", "r"), 16: ("", "m"), 17: ("", "b"), 18: ("p", "s"),
    19: ("", "s"), 20: ("", "ss"), 21: ("ng", ""), 22: ("", "j"), 23: ("", "ch"), 24: ("", "k"),
    25: ("", "t"), 26: ("", "p"), 27: ("", ""),
}

SILENT_INITIAL = 11
RIEUL_INITIAL = 5
RIEUL_FINAL = 8

# IAST letters swapped for the plain spellings people use when writing Hindi lyrics in English letters
HINDI_SPELLINGS = [
    ("ch", "\u0000"), ("c", "ch"), ("\u0000", "chh"), ("|", "."), ("ā", "aa"), ("ī", "ee"), ("ū", "oo"), ("ṛ", "ri"), ("ṝ", "ri"),
    ("ś", "sh"), ("ṣ", "sh"), ("ṅ", "n"), ("ñ", "n"), ("ṭ", "t"), ("ḍ", "d"), ("ṇ", "n"),
    ("ḥ", "h"), ("ṃ", "n"), ("ṁ", "n"), ("m̐", "n"), ("ē", "e"), ("ō", "o"), ("।", "."), ("॥", "."),
]

DEVANAGARI_CONSONANTS = set(range(0x0915, 0x093A)) | set(range(0x0958, 0x0960))

_japanese = None


def is_hangul_syllable(character):
    return HANGUL_FIRST <= ord(character) <= HANGUL_LAST


def split_syllable(character):
    index = ord(character) - HANGUL_FIRST
    initial = index // (MEDIAL_COUNT * FINAL_COUNT)
    medial = (index % (MEDIAL_COUNT * FINAL_COUNT)) // FINAL_COUNT
    final = index % FINAL_COUNT

    return initial, medial, final


def romanize_korean(text):
    parts = []
    characters = list(text)

    # moved: a final consonant carried into the next syllable, which replaces its silent ㅇ
    moved = None

    for position, character in enumerate(characters):
        if not is_hangul_syllable(character):
            parts.append(character)
            moved = None
            continue

        initial, medial, final = split_syllable(character)

        carried = moved is not None and (initial == SILENT_INITIAL or (moved == "l" and initial == RIEUL_INITIAL))

        if carried:
            start = moved
        else:
            start = INITIALS[initial]

        moved = None
        following = characters[position + 1] if position + 1 < len(characters) else ""
        ending = FINALS[final]

        if final and following and is_hangul_syllable(following):
            next_initial = split_syllable(following)[0]

            if next_initial == SILENT_INITIAL:
                ending, moved = LIAISON[final]
            elif final == RIEUL_FINAL and next_initial == RIEUL_INITIAL:
                ending = "l"
                moved = "l"

        parts.append(start + MEDIALS[medial] + ending)

        if moved is not None and not (following and is_hangul_syllable(following)):
            moved = None

    text = "".join(parts)

    return text[:1].upper() + text[1:] if text else text


def ends_with_consonant(word):
    letters = [character for character in word if unicodedata.category(character).startswith(("L", "M"))]

    return bool(letters) and ord(letters[-1]) in DEVANAGARI_CONSONANTS


def romanize_hindi_word(word):
    roman = sanscript.transliterate(word, sanscript.DEVANAGARI, sanscript.IAST)

    # Hindi drops the vowel written at the end of a word ending in a consonant: बहुत is "bahut", not "bahuta"
    syllables = sum(1 for character in word if unicodedata.category(character) == "Lo")
    trailing = ""

    while roman and not roman[-1].isalpha():
        trailing = roman[-1] + trailing
        roman = roman[:-1]

    if syllables > 1 and ends_with_consonant(word) and roman.endswith("a"):
        roman = roman[:-1]

    roman += trailing

    for written, plain in HINDI_SPELLINGS:
        roman = roman.replace(written, plain)

    roman = unicodedata.normalize("NFD", roman)

    return "".join(character for character in roman if not unicodedata.combining(character))


def romanize_hindi(text):
    words = [romanize_hindi_word(word) for word in text.split()]
    sentence = " ".join(words)

    return sentence[:1].upper() + sentence[1:] if sentence else sentence


def romanize_japanese(text):
    global _japanese

    if _japanese is None:
        import cutlet

        _japanese = cutlet.Cutlet()

    return _japanese.romaji(text)


def romanize_line(text, language):
    if language == "ko":
        return romanize_korean(text)

    if language == "hi":
        return romanize_hindi(text)

    if language == "ja":
        return romanize_japanese(text)

    return None
