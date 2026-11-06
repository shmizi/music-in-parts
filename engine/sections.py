import librosa
import numpy as np
import scipy.cluster.hierarchy
import scipy.signal


SAMPLE_RATE = 22050
HOP_LENGTH = 512

# fewer bars than this is too little to find repeating sections
MINIMUM_BARS = 12

# half width of the novelty kernel, in bars
KERNEL_BARS = 4

# nearest two section boundaries can be, in bars
MINIMUM_SECTION_BARS = 4

# how much a novelty peak must stand out, as a fraction of the curve's range
PEAK_PROMINENCE = 0.12

# sections closer than this count as the same part of the song, from 0 (same) to 1
SAME_PART_DISTANCE = 0.42

# intros and outros are only named when they are shorter than this, in seconds
EDGE_SECTION_SECONDS = 30.0


def build_bar_edges(beats, downbeats, duration):
    if len(downbeats) >= MINIMUM_BARS:
        inner = downbeats
    else:
        inner = beats[::4]

    inner = inner[(inner > 0.0) & (inner < duration)]

    return np.concatenate(([0.0], inner, [duration]))


def bar_features(signal, edges):
    bar_frames = librosa.time_to_frames(edges, sr=SAMPLE_RATE, hop_length=HOP_LENGTH)

    chroma = librosa.feature.chroma_cqt(y=signal, sr=SAMPLE_RATE, hop_length=HOP_LENGTH)
    mfcc = librosa.feature.mfcc(y=signal, sr=SAMPLE_RATE, hop_length=HOP_LENGTH, n_mfcc=13)[1:]
    level = librosa.feature.rms(y=signal, hop_length=HOP_LENGTH)
    level = librosa.amplitude_to_db(level, ref=np.max)

    bars = len(edges) - 1
    harmony = np.zeros((bars, chroma.shape[0]))
    timbre = np.zeros((bars, mfcc.shape[0] + 1))

    for bar in range(bars):
        first = min(bar_frames[bar], chroma.shape[1] - 1)
        last = max(first + 1, bar_frames[bar + 1])
        harmony[bar] = chroma[:, first:last].mean(axis=1)
        timbre[bar, :-1] = mfcc[:, first:last].mean(axis=1)
        timbre[bar, -1] = level[:, first:last].mean()

    harmony /= np.maximum(np.linalg.norm(harmony, axis=1, keepdims=True), 1e-9)

    # z-score each timbre dimension so loudness and tone colour count equally
    timbre = (timbre - timbre.mean(axis=0)) / np.maximum(timbre.std(axis=0), 1e-9)

    return harmony, timbre


def similarity_matrix(harmony, timbre):
    # harmony_sim: cosine similarity between bars, from 0 (unrelated) to 1 (same notes)
    harmony_sim = harmony @ harmony.T

    # timbre_sim: 1 for bars that sound alike, falling towards 0 for bars that don't
    differences = timbre[:, None, :] - timbre[None, :, :]
    distances = np.sqrt((differences ** 2).sum(axis=2))
    scale = np.median(distances[distances > 0]) if np.any(distances > 0) else 1.0
    timbre_sim = np.exp(-(distances / scale) ** 2)

    return 0.5 * (harmony_sim + timbre_sim)


def checkerboard_kernel(half_width):
    coordinates = np.arange(-half_width, half_width) + 0.5
    signs = np.sign(coordinates)
    taper = np.exp(-(coordinates / half_width) ** 2)

    return np.outer(signs, signs) * np.outer(taper, taper)


def novelty_curve(similarity, half_width=KERNEL_BARS):
    bars = similarity.shape[0]
    kernel = checkerboard_kernel(half_width)
    padded = np.pad(similarity, half_width, mode="edge")
    novelty = np.zeros(bars)

    for bar in range(bars):
        centre = bar + half_width
        patch = padded[centre - half_width:centre + half_width, centre - half_width:centre + half_width]
        novelty[bar] = np.sum(kernel * patch)

    return np.maximum(novelty, 0.0)


def pick_boundaries(novelty):
    spread = novelty.max() - novelty.min()

    if spread <= 0:
        return []

    peaks, _ = scipy.signal.find_peaks(
        novelty,
        distance=MINIMUM_SECTION_BARS,
        prominence=PEAK_PROMINENCE * spread,
    )

    return [int(peak) for peak in peaks if MINIMUM_SECTION_BARS <= peak <= len(novelty) - MINIMUM_SECTION_BARS]


def segment_distance(first, second, similarity):
    # compare bar by bar from the start of each section, over the length they share
    shared = min(first[1] - first[0], second[1] - second[0])

    aligned = np.mean([similarity[first[0] + offset, second[0] + offset] for offset in range(shared)])

    # longest: a section much longer than the other counts as somewhat less alike
    longest = max(first[1] - first[0], second[1] - second[0])
    length_match = shared / longest

    return 1.0 - aligned * (0.7 + 0.3 * length_match)


def cluster_segments(segments, similarity):
    if len(segments) < 2:
        return [0] * len(segments)

    distances = [
        segment_distance(segments[first], segments[second], similarity)
        for first in range(len(segments))
        for second in range(first + 1, len(segments))
    ]

    tree = scipy.cluster.hierarchy.linkage(np.maximum(distances, 0.0), method="average")
    labels = scipy.cluster.hierarchy.fcluster(tree, t=SAME_PART_DISTANCE, criterion="distance")

    return [int(label) for label in labels]


def join_matching_neighbours(runs):
    joined = []

    for run in runs:
        if joined and joined[-1]["cluster"] == run["cluster"]:
            joined[-1]["end"] = run["end"]
        else:
            joined.append(dict(run))

    return joined


def loudness_per_run(runs, signal):
    values = []

    for run in runs:
        first = int(run["start"] * SAMPLE_RATE)
        last = int(run["end"] * SAMPLE_RATE)
        values.append(float(np.sqrt(np.mean(signal[first:last] ** 2))) if last > first else 0.0)

    return values


def name_sections(runs, loudness):
    seconds = {}
    positions = {}
    energy = {}

    for index, (run, level) in enumerate(zip(runs, loudness)):
        cluster = run["cluster"]
        length = run["end"] - run["start"]
        seconds[cluster] = seconds.get(cluster, 0.0) + length
        positions.setdefault(cluster, []).append(index)
        energy[cluster] = energy.get(cluster, 0.0) + level * length

    last_index = len(runs) - 1
    edge_clusters = {
        cluster
        for cluster, indexes in positions.items()
        if all(index in (0, last_index) for index in indexes)
    }

    average_energy = {cluster: energy[cluster] / seconds[cluster] for cluster in seconds}
    repeated = [
        cluster
        for cluster, indexes in positions.items()
        if len(indexes) > 1 and cluster not in edge_clusters
    ]

    names = {}

    if repeated:
        chorus = max(repeated, key=lambda cluster: average_energy[cluster])
        names[chorus] = "Chorus"

        others = sorted(
            (cluster for cluster in repeated if cluster != chorus),
            key=lambda cluster: seconds[cluster],
            reverse=True,
        )

        if others:
            names[others[0]] = "Verse"

    letters = iter("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
    counts = {}
    sections = []

    for index, run in enumerate(runs):
        cluster = run["cluster"]
        length = run["end"] - run["start"]

        if len(runs) > 1 and cluster in edge_clusters and length < EDGE_SECTION_SECONDS:
            label = "Intro" if index == 0 else "Outro"
        elif len(positions[cluster]) == 1 and "Bridge" not in counts and 0 < index < last_index:
            label = "Bridge"
        else:
            if cluster not in names:
                names[cluster] = f"Part {next(letters)}"

            label = names[cluster]

        counts[label] = counts.get(label, 0) + 1
        sections.append({"start": run["start"], "end": run["end"], "base": label, "number": counts[label]})

    return [
        {
            "start": round(section["start"], 3),
            "end": round(section["end"], 3),
            "label": section["base"] if counts[section["base"]] == 1 else f"{section['base']} {section['number']}",
        }
        for section in sections
    ]


def find_sections(signal, beats, downbeats, duration):
    edges = build_bar_edges(beats, downbeats, duration)

    if len(edges) - 1 < MINIMUM_BARS:
        return [{"start": 0.0, "end": round(duration, 3), "label": "Song"}]

    harmony, timbre = bar_features(signal, edges)
    similarity = similarity_matrix(harmony, timbre)
    boundaries = pick_boundaries(novelty_curve(similarity))

    cut_points = [0, *boundaries, len(edges) - 1]
    segments = list(zip(cut_points[:-1], cut_points[1:]))
    clusters = cluster_segments(segments, similarity)

    runs = [
        {"start": float(edges[first]), "end": float(edges[last]), "cluster": cluster}
        for (first, last), cluster in zip(segments, clusters)
    ]

    runs = join_matching_neighbours(runs)

    return name_sections(runs, loudness_per_run(runs, signal))
