import argparse
import json
import re
import sys
import types
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

from lyric_sections import plain as normalise
from romanize import ROMANIZED_LANGUAGES, romanize_line


EVENT_STREAM = sys.stdout
LYRICS_VERSION = 2

WHISPER_RATE = 16000
WHISPER_MODEL = "turbo"
DETECTION_SECONDS = 30.0

# frames used to find where someone is singing, in seconds
FRAME_SECONDS = 0.02

# singing must be within this many decibels of the loudest singing to count
LEVEL_RANGE_DB = 35.0

# anything quieter than this, in decibels below full scale, is treated as silence
SILENCE_DB = -55.0

# pauses shorter than this inside singing are bridged over, in seconds
BRIDGE_SECONDS = 1.0

# bursts of sound shorter than this are ignored, in seconds
SHORTEST_SINGING = 0.3

# extra time kept either side of each stretch of singing, in seconds
REGION_PADDING = 0.25

# how far before the end of the audio the last stretch of singing must stop, in seconds
END_MARGIN = 0.05

# a pause this long between words starts a new lyric line, in seconds
LINE_BREAK_SECONDS = 0.9

# longest line before it gets split at its biggest pause, in characters
LONGEST_SPACED_LINE = 60
LONGEST_UNSPACED_LINE = 24

# singing with no words for at least this long is listened to again, in seconds
GAP_SECONDS = 2.5

# singing this close to the loudest singing, in decibels, is clearly a voice and not bleed
CLEAR_SINGING_DB = 25.0

# share of a gap that must be clear singing before it is listened to again
GAP_SINGING_SHARE = 0.35

# gaps are listened to again in windows of about this length, in seconds
GAP_WINDOW = 8.0

# a window is cut at its quietest moment within this long of its end, in seconds
GAP_CUT_SEARCH = 2.0

# recovered words the model is less sure of than this are thrown away, from 0 to 1
RECOVERED_WORD_PROBABILITY = 0.5

# two listens agree on a word when they place it within this many seconds of each other
AGREEMENT_SECONDS = 0.7

# recovered words that only one listen heard are shown as doubtful by capping their confidence
UNAGREED_CONFIDENCE = 0.35

# a phrase repeated this many times in a row, starting unsure, is the model stuck in a loop
LOOP_REPEATS = 3
LOOP_FIRST_PROBABILITY = 0.5

# singing left without words for this long is marked on the lyric sheet, in seconds
UNHEARD_SECONDS = 4.0

# how much a comma or a full stop adds to the case for breaking a long line there
COMMA_BONUS = 0.3
SENTENCE_BONUS = 0.5

# how much a capital letter on the next word adds, since it usually starts a new phrase
CAPITAL_BONUS = 0.25

# how much uneven halves count against a place to break a long line
BALANCE_COST = 0.4

SENTENCE_ENDINGS = ".!?\u3002\uff01\uff1f"
PHRASE_ENDINGS = ",;:\u3001\uff0c"

BACKING_STEMS = ("drums", "bass", "guitar", "piano", "other")

# when Whisper can't tell Hindi from Urdu, show Hindi in Devanagari
HINDUSTANI_CODES = ("hi", "ur")

LANGUAGE_NAMES = {"tl": "Filipino (Tagalog)"}

SECTION_LINE = re.compile(r"^\s*(\[.*\]|\(.*\)|[^\s].{0,30}:)\s*$")
CHORD_TOKEN = re.compile(r"^[A-G][#b]?(m|maj|min|dim|aug|sus|add|M)?\d*(/[A-G][#b]?)?$")


def emit(event_type, **fields):
    EVENT_STREAM.write(json.dumps({"type": event_type, **fields}, ensure_ascii=False) + "\n")
    EVENT_STREAM.flush()


def write_json(path, value):
    temporary_path = path.with_name(path.name + ".tmp")
    temporary_path.write_text(json.dumps(value, ensure_ascii=False, indent=1), encoding="utf-8")
    temporary_path.replace(path)


def language_name(code):
    if code in LANGUAGE_NAMES:
        return LANGUAGE_NAMES[code]

    from whisper.tokenizer import LANGUAGES

    return LANGUAGES.get(code, code).title()


def read_vocals(song_dir):
    audio, rate = sf.read(song_dir / "stems" / "vocals.wav", dtype="float32", always_2d=True)
    mono = audio.mean(axis=1)

    return librosa.resample(mono, orig_sr=rate, target_sr=WHISPER_RATE)


def read_backing(song_dir, length):
    backing = np.zeros(length, dtype=np.float32)

    for name in BACKING_STEMS:
        path = song_dir / "stems" / f"{name}.wav"

        if path.exists():
            audio, rate = sf.read(path, dtype="float32", always_2d=True)
            stem = librosa.resample(audio.mean(axis=1), orig_sr=rate, target_sr=WHISPER_RATE)
            shared = min(length, len(stem))
            backing[:shared] += stem[:shared]

    return backing


def clear_singing(signal, rate=WHISPER_RATE):
    hop = int(FRAME_SECONDS * rate)
    level = librosa.feature.rms(y=signal, frame_length=hop * 2, hop_length=hop)[0]
    decibels = 20 * np.log10(np.maximum(level, 1e-10))
    loud = np.percentile(decibels, 95)

    # clear: one flag per frame, True where the voice is close to its loudest level in the song
    clear = decibels > max(loud - CLEAR_SINGING_DB, SILENCE_DB)

    return clear, decibels


def find_gaps(words, regions, clear, shortest=GAP_SECONDS):
    gaps = []

    for begin, finish in regions:
        inside = [word for word in words if begin <= (word["start"] + word["end"]) / 2 <= finish]
        edges = [begin, *[time for word in inside for time in (word["start"], word["end"])], finish]

        for start, end in zip(edges[::2], edges[1::2]):
            first = int(start / FRAME_SECONDS)
            last = min(len(clear), int(end / FRAME_SECONDS))
            frames = np.flatnonzero(clear[first:last])

            if len(frames) == 0:
                continue

            # trim the gap to where the clear singing starts and stops
            trimmed_start = max(start, (first + frames[0]) * FRAME_SECONDS - REGION_PADDING)
            trimmed_end = min(end, (first + frames[-1] + 1) * FRAME_SECONDS + REGION_PADDING)
            share = len(frames) / max(1, frames[-1] - frames[0] + 1)

            if trimmed_end - trimmed_start >= shortest and share >= GAP_SINGING_SHARE:
                gaps.append((round(float(trimmed_start), 3), round(float(trimmed_end), 3)))

    return gaps


def split_gap(start, end, decibels):
    windows = []

    while end - start > GAP_WINDOW + GAP_CUT_SEARCH:
        first = int((start + GAP_WINDOW - GAP_CUT_SEARCH) / FRAME_SECONDS)
        last = int((start + GAP_WINDOW) / FRAME_SECONDS)
        cut = (first + int(np.argmin(decibels[first:last]))) * FRAME_SECONDS
        windows.append((start, cut))
        start = cut

    return [*windows, (start, end)]


def drop_loops(words):
    texts = [normalise(word["text"]) for word in words]

    for length in range(1, 9):
        for first in range(len(words) - length * LOOP_REPEATS + 1):
            phrase = texts[first:first + length]
            repeats = 1

            while texts[first + repeats * length:first + (repeats + 1) * length] == phrase:
                repeats += 1

            started_unsure = np.mean([word["confidence"] for word in words[first:first + length]]) < LOOP_FIRST_PROBABILITY

            if repeats >= LOOP_REPEATS and started_unsure and sum(len(text) for text in phrase) >= 4:
                return words[:first] + words[first + repeats * length:]

    return words


def heard_by_both(word, other):
    return any(
        normalise(word["text"]) == normalise(candidate["text"])
        and abs(word["start"] - candidate["start"]) <= AGREEMENT_SECONDS
        for candidate in other
    )


def pick_recovered(listens):
    # listens: one list of words for each way the window was listened to
    cleaned = [
        [
            word
            for word in drop_loops(words)
            if word["confidence"] >= RECOVERED_WORD_PROBABILITY and normalise(word["text"])
        ]
        for words in listens
    ]

    best = max(range(len(cleaned)), key=lambda index: sum(word["confidence"] for word in cleaned[index]))
    others = [word for index, words in enumerate(cleaned) if index != best for word in words]

    return [
        {
            "text": word["text"],
            "start": word["start"],
            "end": word["end"],
            "confidence": round(
                word["confidence"] if heard_by_both(word, others) else min(word["confidence"], UNAGREED_CONFIDENCE),
                3,
            ),
            "recovered": True,
        }
        for word in cleaned[best]
    ]


def listen_to_window(model, signal, start, end, language, device):
    clip = signal[int(start * WHISPER_RATE):int(end * WHISPER_RATE)]

    result = model.transcribe(
        clip,
        language=language,
        task="transcribe",
        word_timestamps=True,
        condition_on_previous_text=False,
        temperature=0.0,
        logprob_threshold=None,
        fp16=device == "cuda",
        verbose=None,
    )

    return [
        {
            "text": word["word"],
            "start": round(float(start + word["start"]), 3),
            "end": round(float(min(end, start + word["end"])), 3),
            "confidence": round(float(word.get("probability", 0.0)), 3),
        }
        for segment in result["segments"]
        for word in segment.get("words", [])
        if word["word"].strip() and start + word["start"] < end
    ]


def merge_words(words, recovered):
    merged = sorted([*words, *recovered], key=lambda word: word["start"])

    for before, after in zip(merged, merged[1:]):
        before["end"] = min(before["end"], max(before["start"], after["start"]))

    return merged


def recover_missing(model, song_dir, vocals, words, regions, language, device):
    clear, decibels = clear_singing(vocals)
    gaps = find_gaps(words, regions, clear)

    if not gaps:
        return words

    emit("stage", stage="listening-again", device=device)

    # a second way to hear each gap: the singing with the band behind it, which is what the model was trained on
    mix = vocals + read_backing(song_dir, len(vocals))
    windows = [window for start, end in gaps for window in split_gap(start, end, decibels)]
    recovered = []

    for start, end in windows:
        listens = [listen_to_window(model, source, start, end, language, device) for source in (vocals, mix)]
        recovered.extend(pick_recovered(listens))

    return merge_words(words, recovered)


def unheard_stretches(words, regions, vocals):
    clear, _ = clear_singing(vocals)

    return [list(gap) for gap in find_gaps(words, regions, clear, shortest=UNHEARD_SECONDS)]


def singing_regions(signal, rate=WHISPER_RATE):
    hop = int(FRAME_SECONDS * rate)

    if len(signal) < hop:
        return []

    level = librosa.feature.rms(y=signal, frame_length=hop * 2, hop_length=hop)[0]
    decibels = 20 * np.log10(np.maximum(level, 1e-10))

    loud = np.percentile(decibels, 95)
    threshold = max(loud - LEVEL_RANGE_DB, SILENCE_DB)
    active = decibels > threshold

    regions = []
    start = None

    for frame, is_active in enumerate(active):
        if is_active and start is None:
            start = frame
        elif not is_active and start is not None:
            regions.append([start * FRAME_SECONDS, frame * FRAME_SECONDS])
            start = None

    if start is not None:
        regions.append([start * FRAME_SECONDS, len(active) * FRAME_SECONDS])

    bridged = []

    for region in regions:
        if bridged and region[0] - bridged[-1][1] < BRIDGE_SECONDS:
            bridged[-1][1] = region[1]
        else:
            bridged.append(region)

    # Whisper never finishes when asked to read past the end of the audio, so regions stop just short of it
    duration = max(0.0, len(signal) / rate - END_MARGIN)

    return [
        (max(0.0, begin - REGION_PADDING), min(duration, end + REGION_PADDING))
        for begin, end in bridged
        if end - begin >= SHORTEST_SINGING
    ]


def detection_sample(signal, regions, rate=WHISPER_RATE):
    pieces = []
    gathered = 0

    for begin, end in regions:
        piece = signal[int(begin * rate):int(end * rate)]
        pieces.append(piece)
        gathered += len(piece)

        if gathered >= DETECTION_SECONDS * rate:
            break

    return np.concatenate(pieces) if pieces else signal[:int(DETECTION_SECONDS * rate)]


def choose_language(probabilities):
    ranked = sorted(probabilities.items(), key=lambda item: item[1], reverse=True)
    best = ranked[0][0]

    if best in HINDUSTANI_CODES:
        best = "hi"

    detected = [
        {"code": code, "name": language_name(code), "probability": round(float(probability), 3)}
        for code, probability in ranked[:3]
    ]

    return best, detected


def install_progress_hook(transcribe_module):
    class ProgressBar:
        def __init__(self, total=None, **_):
            self.total = total or 1
            self.done = 0

        def update(self, amount):
            self.done += amount
            emit("progress", fraction=min(1.0, self.done / self.total))

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

    transcribe_module.tqdm = types.SimpleNamespace(tqdm=ProgressBar)


def inside_regions(start, end, regions):
    middle = (start + end) / 2

    return any(begin <= middle <= finish for begin, finish in regions)


def collect_words(result, regions):
    words = []

    for segment in result["segments"]:
        for word in segment.get("words", []):
            text = word["word"]

            if not text.strip() or not inside_regions(word["start"], word["end"], regions):
                continue

            words.append({
                "text": text,
                "start": round(float(word["start"]), 3),
                "end": round(float(word["end"]), 3),
                "confidence": round(float(word.get("probability", 0.0)), 3),
            })

    return words


def is_unspaced(words):
    joined = "".join(word["text"] for word in words)
    return bool(joined) and " " not in joined.strip()


def split_long_line(line, longest):
    text = "".join(word["text"] for word in line).strip()

    if len(text) <= longest or len(line) < 2:
        return [line]

    lengths = np.cumsum([len(word["text"]) for word in line])
    scores = []

    for index in range(len(line) - 1):
        ending = line[index]["text"].rstrip()[-1:]
        pause = line[index + 1]["start"] - line[index]["end"]
        bonus = SENTENCE_BONUS if ending and ending in SENTENCE_ENDINGS else COMMA_BONUS if ending and ending in PHRASE_ENDINGS else 0.0

        following = line[index + 1]["text"].strip()

        if len(following) > 1 and following[0].isupper() and not following.startswith("I'"):
            bonus = max(bonus, CAPITAL_BONUS)

        # uneven: 0 when the cut is in the middle of the line, 1 when it is at one end
        uneven = abs(2 * lengths[index] - lengths[-1]) / lengths[-1]
        scores.append(pause + bonus - BALANCE_COST * uneven)

    cut = int(np.argmax(scores)) + 1

    return split_long_line(line[:cut], longest) + split_long_line(line[cut:], longest)


def build_lines(words, language):
    lines = []
    current = []

    for word in words:
        if current and word["start"] - current[-1]["end"] >= LINE_BREAK_SECONDS:
            lines.append(current)
            current = []

        current.append(word)

    if current:
        lines.append(current)

    longest = LONGEST_UNSPACED_LINE if is_unspaced(words) else LONGEST_SPACED_LINE
    split = [piece for line in lines for piece in split_long_line(line, longest)]

    return [finish_line(line, language) for line in split]


def finish_line(words, language):
    words = [dict(word) for word in words]
    words[0]["text"] = words[0]["text"].lstrip()
    text = "".join(word["text"] for word in words)

    line = {
        "start": words[0]["start"],
        "end": words[-1]["end"],
        "text": text,
        "words": words,
    }

    if language in ROMANIZED_LANGUAGES:
        line["romanized"] = romanize_line(text, language)

    return line


def transcribe(song_dir, models_dir, language):
    import torch
    import whisper
    import whisper.transcribe

    emit("stage", stage="finding-singing")
    signal = read_vocals(song_dir)
    regions = singing_regions(signal)

    if not regions:
        return {"version": LYRICS_VERSION, "language": None, "languageName": None, "detected": [], "lines": [], "unheard": []}

    device = "cuda" if torch.cuda.is_available() else "cpu"
    emit("stage", stage="loading-lyrics-model", device=device)
    model = whisper.load_model(WHISPER_MODEL, device=device, download_root=str(models_dir / "whisper"))

    detected = []

    if language == "auto":
        emit("stage", stage="detecting-language", device=device)
        sample = whisper.pad_or_trim(detection_sample(signal, regions))
        mel = whisper.log_mel_spectrogram(sample, n_mels=model.dims.n_mels).to(device)
        _, probabilities = model.detect_language(mel)
        language, detected = choose_language(probabilities)

    emit("stage", stage="transcribing", device=device)
    install_progress_hook(whisper.transcribe)

    result = model.transcribe(
        signal,
        language=language,
        task="transcribe",
        word_timestamps=True,
        condition_on_previous_text=False,
        temperature=(0.0, 0.2, 0.4, 0.6, 0.8),
        compression_ratio_threshold=2.4,
        logprob_threshold=-1.0,
        no_speech_threshold=0.6,
        hallucination_silence_threshold=2.0,
        clip_timestamps=[value for region in regions for value in region],
        fp16=device == "cuda",
        verbose=None,
    )

    words = collect_words(result, regions)
    words = recover_missing(model, song_dir, signal, words, regions, language, device)

    emit("stage", stage="romanising" if language in ROMANIZED_LANGUAGES else "writing")

    return {
        "version": LYRICS_VERSION,
        "language": language,
        "languageName": language_name(language),
        "detected": detected,
        "source": "transcribed",
        "lines": build_lines(words, language),
        "unheard": unheard_stretches(words, regions, signal),
    }


def is_unspaced_character(character):
    name = unicodedata.name(character, "")
    return name.startswith(("CJK", "HIRAGANA", "KATAKANA", "HANGUL", "THAI"))


def split_display_words(line):
    words = []

    for chunk in line.split():
        pieces = []

        for character in chunk:
            if is_unspaced_character(character) or not pieces or is_unspaced_character(pieces[-1][-1]):
                if pieces and not normalise(character):
                    pieces[-1] += character
                else:
                    pieces.append(character)
            else:
                pieces[-1] += character

        for index, piece in enumerate(pieces):
            words.append({"text": piece, "spaced": index == 0})

    return words


def is_skipped_line(line):
    tokens = line.split()

    if not tokens:
        return True

    if SECTION_LINE.match(line):
        return True

    return all(CHORD_TOKEN.match(token) for token in tokens)


def timed_characters(lines):
    characters = []

    for line in lines:
        for word in line["words"]:
            letters = normalise(word["text"])

            if not letters:
                continue

            step = (word["end"] - word["start"]) / len(letters)

            for position, letter in enumerate(letters):
                start = word["start"] + position * step
                characters.append((letter, start, start + step))

    return characters


def align_pasted(text, transcribed_lines, language):
    pasted_lines = [line.strip() for line in text.splitlines()]
    pasted_lines = [line for line in pasted_lines if not is_skipped_line(line)]

    if not pasted_lines:
        raise RuntimeError("No lyric lines were found in the pasted text.")

    heard = timed_characters(transcribed_lines)

    if not heard:
        raise RuntimeError("No sung words were found to line the lyrics up with.")

    words = []
    letters = []

    for line_index, line in enumerate(pasted_lines):
        for display in split_display_words(line):
            display["line"] = line_index
            display["letters"] = (len(letters), len(letters) + len(normalise(display["text"])))
            letters.extend(normalise(display["text"]))
            words.append(display)

    heard_letters = [letter for letter, _, _ in heard]

    # times: for every pasted letter, the start and end of the sung letter it matches
    times = [None] * len(letters)
    matcher = SequenceMatcher(None, letters, heard_letters, autojunk=False)

    for block in matcher.get_matching_blocks():
        for offset in range(block.size):
            _, start, end = heard[block.b + offset]
            times[block.a + offset] = (start, end)

    for word in words:
        first, last = word["letters"]
        matched = [times[position] for position in range(first, last) if times[position] is not None]
        word["estimated"] = len(matched) < max(1, (last - first) / 2)

        if matched:
            word["start"] = matched[0][0]
            word["end"] = matched[-1][1]
        else:
            word["start"] = None
            word["end"] = None

    fill_missing_times(words, heard[0][1], heard[-1][2])

    lines = []

    for line_index, line in enumerate(pasted_lines):
        line_words = [
            {
                "text": (" " if word["spaced"] and position > 0 else "") + word["text"],
                "start": round(word["start"], 3),
                "end": round(max(word["end"], word["start"]), 3),
                "confidence": 0.3 if word["estimated"] else 1.0,
                "estimated": word["estimated"],
            }
            for position, word in enumerate(item for item in words if item["line"] == line_index)
        ]

        lines.append(finish_line(line_words, language))

    return lines


def fill_missing_times(words, first_time, last_time):
    known = [index for index, word in enumerate(words) if word["start"] is not None]

    if not known:
        step = (last_time - first_time) / len(words)

        for index, word in enumerate(words):
            word["start"] = first_time + index * step
            word["end"] = word["start"] + step

        return

    for index, word in enumerate(words):
        if word["start"] is not None:
            continue

        before = max((position for position in known if position < index), default=None)
        after = min((position for position in known if position > index), default=None)

        begin = words[before]["end"] if before is not None else first_time
        finish = words[after]["start"] if after is not None else last_time
        span_first = before + 1 if before is not None else 0
        span_last = after if after is not None else len(words)
        count = span_last - span_first
        step = max(finish - begin, 0.0) / max(count, 1)

        word["start"] = begin + (index - span_first) * step
        word["end"] = word["start"] + step


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--song-dir", required=True, type=Path)
    parser.add_argument("--models-dir", required=True, type=Path)
    parser.add_argument("--language", default="auto")
    parser.add_argument("--paste", type=Path)
    args = parser.parse_args()

    sys.stdout = sys.stderr

    if args.paste:
        emit("stage", stage="lining-up")
        transcribed = json.loads((args.song_dir / "lyrics.json").read_text(encoding="utf-8"))
        language = transcribed.get("language")
        text = args.paste.read_text(encoding="utf-8")

        lyrics = {
            **transcribed,
            "source": "pasted",
            "lines": align_pasted(text, transcribed["lines"], language),
        }

        write_json(args.song_dir / "lyrics-edited.json", lyrics)
        args.paste.unlink()
    else:
        lyrics = transcribe(args.song_dir, args.models_dir, args.language)
        write_json(args.song_dir / "lyrics.json", lyrics)

    emit("done", language=lyrics.get("language"), lines=len(lyrics["lines"]))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit("error", message=str(error))
        raise
