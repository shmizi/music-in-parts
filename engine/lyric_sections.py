import unicodedata


# fewer sung words than this is too little to learn anything about the song's sections
MINIMUM_WORDS = 20

# letters in a row that must match for words to count as repeated, with and without spaces between words
REPEAT_LETTERS_SPACED = 8
REPEAT_LETTERS_UNSPACED = 4

# a repeat only counts when the two copies are at least this far apart, in seconds
REPEAT_DISTANCE = 15.0

# a bar is part of a chorus when at least this share of the words around it are repeated
CHORUS_SHARE = 0.5

# words the transcription is less sure of than this, from 0 to 1, are likely misheard, so they
# can't show that a line is new
UNSURE_WORD = 0.6

# sections found from the lyrics are at least this many bars long
MINIMUM_SECTION_BARS = 4

# bars without words only count as instrumental when at least this many come in a row
MINIMUM_EMPTY_BARS = 2

# an instrumental section is named after a solo that fills at least this share of it
SOLO_SHARE = 0.5

# bar length used when the song has no bar lines, in seconds
FALLBACK_BAR_SECONDS = 2.0

CHORUS = "chorus"
VERSE = "verse"
EMPTY = "empty"


def plain(text):
    kept = [
        character.lower()
        for character in unicodedata.normalize("NFKC", text)
        if not unicodedata.category(character).startswith(("P", "S", "Z", "C"))
    ]

    return "".join(kept)


def flatten_words(lyrics):
    words = []

    for line in (lyrics or {}).get("lines", []):
        for word in line["words"]:
            letters = plain(word["text"])

            if letters:
                words.append({
                    "letters": letters,
                    "start": word["start"],
                    "end": word["end"],
                    "spaced": word["text"][:1].isspace(),
                    "confidence": word.get("confidence", 1.0),
                })

    return words


def is_unspaced(words):
    spaced = sum(1 for word in words if word["spaced"])
    return spaced < len(words) / 4


def repeated_words(words):
    run = REPEAT_LETTERS_UNSPACED if is_unspaced(words) else REPEAT_LETTERS_SPACED

    # letters: every letter of the lyrics in order, with the time of the word it belongs to
    letters = [(letter, word["start"], index) for index, word in enumerate(words) for letter in word["letters"]]
    stream = "".join(letter for letter, _, _ in letters)
    seen = {}

    for position in range(len(stream) - run + 1):
        seen.setdefault(stream[position:position + run], []).append(position)

    letter_repeated = [False] * len(stream)

    for positions in seen.values():
        for position in positions:
            time = letters[position][1]

            if any(abs(letters[other][1] - time) >= REPEAT_DISTANCE for other in positions):
                for offset in range(run):
                    letter_repeated[position + offset] = True

    counts = [0] * len(words)

    for (_, _, index), repeated in zip(letters, letter_repeated):
        counts[index] += repeated

    return [count * 2 >= len(word["letters"]) for word, count in zip(words, counts)]


def bar_edges(analysis, duration):
    downbeats = [time for time in analysis.get("downbeats", []) if 0 < time < duration]

    if len(downbeats) >= 8:
        return [0.0, *downbeats, duration]

    beats = [time for time in analysis.get("beats", []) if 0 < time < duration]

    if len(beats) >= 32:
        return [0.0, *beats[::4], duration]

    count = max(1, int(duration / FALLBACK_BAR_SECONDS))

    return [index * FALLBACK_BAR_SECONDS for index in range(count)] + [duration]


def bar_of(time, edges):
    for index in range(len(edges) - 1):
        if time < edges[index + 1]:
            return index

    return len(edges) - 2


def label_bars(words, repeated, edges):
    bars = len(edges) - 1
    sung = [0] * bars
    again = [0] * bars

    heard = [0] * bars

    for word, is_repeated in zip(words, repeated):
        bar = bar_of((word["start"] + word["end"]) / 2, edges)
        heard[bar] += 1

        if is_repeated or word["confidence"] >= UNSURE_WORD:
            sung[bar] += 1
            again[bar] += is_repeated

    labels = []

    for bar in range(bars):
        nearby = range(max(0, bar - 1), min(bars, bar + 2))
        words_nearby = sum(sung[index] for index in nearby)
        repeated_nearby = sum(again[index] for index in nearby)

        if words_nearby == 0:
            labels.append(EMPTY if sum(heard[index] for index in nearby) == 0 else None)
        else:
            labels.append(CHORUS if repeated_nearby / words_nearby >= CHORUS_SHARE else VERSE)

    # a bar with no words of its own is instrumental when its neighbours are empty too
    for bar in range(bars):
        if heard[bar] > 0:
            continue

        first = bar

        while first > 0 and heard[first - 1] == 0:
            first -= 1

        last = bar

        while last < bars - 1 and heard[last + 1] == 0:
            last += 1

        if last - first + 1 >= MINIMUM_EMPTY_BARS:
            labels[bar] = EMPTY

    # bars where every word was unsure take the label of the nearest bar that has one
    known = [bar for bar in range(bars) if labels[bar] is not None]

    for bar in range(bars):
        if labels[bar] is None:
            nearest = min(known, key=lambda other: abs(other - bar), default=None)
            labels[bar] = labels[nearest] if nearest is not None else VERSE

    return labels


def runs_of(labels):
    runs = []

    for bar, label in enumerate(labels):
        if runs and runs[-1]["kind"] == label:
            runs[-1]["last"] = bar + 1
        else:
            runs.append({"kind": label, "first": bar, "last": bar + 1})

    return runs


def merge_short_runs(runs):
    runs = [dict(run) for run in runs]

    while len(runs) > 1:
        lengths = [run["last"] - run["first"] for run in runs]
        shortest = min(range(len(runs)), key=lambda index: lengths[index])

        if lengths[shortest] >= MINIMUM_SECTION_BARS:
            break

        neighbours = [index for index in (shortest - 1, shortest + 1) if 0 <= index < len(runs)]
        keeper = max(neighbours, key=lambda index: lengths[index])

        runs[keeper]["first"] = min(runs[keeper]["first"], runs[shortest]["first"])
        runs[keeper]["last"] = max(runs[keeper]["last"], runs[shortest]["last"])
        del runs[shortest]

        joined = []

        for run in runs:
            if joined and joined[-1]["kind"] == run["kind"]:
                joined[-1]["last"] = run["last"]
            else:
                joined.append(run)

        runs = joined

    return runs


def split_empty_runs(runs, sections, edges):
    # where nobody sings, the lyrics say nothing, so the boundaries found from the sound are kept
    boundaries = [bar_of(section["start"] + 1e-3, edges) for section in sections[1:]]
    pieces = []

    for run in runs:
        cuts = [
            bar
            for bar in boundaries
            if run["kind"] == EMPTY
            and bar - run["first"] >= MINIMUM_SECTION_BARS
            and run["last"] - bar >= MINIMUM_SECTION_BARS
        ]

        starts = [run["first"], *sorted(set(cuts))]

        for first, last in zip(starts, [*starts[1:], run["last"]]):
            pieces.append({"kind": run["kind"], "first": first, "last": last})

    return pieces


def solo_name(start, end, solos):
    for solo in solos:
        overlap = min(end, solo["end"]) - max(start, solo["start"])

        if overlap >= SOLO_SHARE * (end - start):
            return solo["label"].title()

    return None


def name_runs(runs, edges, solos):
    choruses_so_far = 0
    verse_indexes = [index for index, run in enumerate(runs) if run["kind"] == VERSE]
    bases = []

    for index, run in enumerate(runs):
        start = edges[run["first"]]
        end = edges[run["last"]]

        if run["kind"] == CHORUS:
            choruses_so_far += 1
            bases.append("Chorus")
        elif run["kind"] == VERSE:
            # the last new set of words, coming after two choruses and two verses, is usually the bridge
            is_last_verse = index == verse_indexes[-1]
            is_bridge = is_last_verse and len(verse_indexes) >= 3 and choruses_so_far >= 2 and index < len(runs) - 1
            bases.append("Bridge" if is_bridge else "Verse")
        elif index == 0:
            bases.append("Intro")
        elif index == len(runs) - 1:
            bases.append("Outro")
        else:
            bases.append(solo_name(start, end, solos) or "Instrumental")

    totals = {base: bases.count(base) for base in bases}
    counts = {}
    sections = []

    for run, base in zip(runs, bases):
        counts[base] = counts.get(base, 0) + 1

        sections.append({
            "start": round(float(edges[run["first"]]), 3),
            "end": round(float(edges[run["last"]]), 3),
            "label": base if totals[base] == 1 else f"{base} {counts[base]}",
        })

    return sections


def sections_from_lyrics(analysis, lyrics, notes):
    words = flatten_words(lyrics)
    sections = analysis.get("sections", [])

    if len(words) < MINIMUM_WORDS or not sections:
        return None

    duration = sections[-1]["end"]
    edges = bar_edges(analysis, duration)

    if len(edges) - 1 < MINIMUM_SECTION_BARS * 2:
        return None

    labels = label_bars(words, repeated_words(words), edges)
    runs = merge_short_runs(runs_of(labels))

    if not any(run["kind"] == CHORUS for run in runs):
        return None

    runs = split_empty_runs(runs, sections, edges)

    return name_runs(runs, edges, (notes or {}).get("solos", []))
