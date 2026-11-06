import argparse
import json
import subprocess
import sys
import types
from pathlib import Path

import imageio_ffmpeg
import numpy as np
import soundfile as sf
import torch
import demucs.apply
from demucs.apply import apply_model
from demucs.pretrained import get_model


SAMPLE_RATE = 44100
MODEL_NAME = "htdemucs_6s"
EVENT_STREAM = sys.stdout


def emit(event_type, **fields):
    EVENT_STREAM.write(json.dumps({"type": event_type, **fields}) + "\n")
    EVENT_STREAM.flush()


def decode_audio(input_path, wav_path):
    command = [
        imageio_ffmpeg.get_ffmpeg_exe(),
        "-nostdin",
        "-y",
        "-i", str(input_path),
        "-vn",
        "-map", "0:a:0",
        "-ac", "2",
        "-ar", str(SAMPLE_RATE),
        "-c:a", "pcm_f32le",
        str(wav_path),
    ]

    result = subprocess.run(command, capture_output=True)

    if result.returncode != 0:
        details = result.stderr.decode("utf-8", "replace").strip().splitlines()
        last_line = details[-1] if details else "unknown error"
        raise RuntimeError(f"Could not read this audio file: {last_line}")

    audio, _ = sf.read(wav_path, dtype="float32", always_2d=True)

    if audio.shape[0] == 0:
        raise RuntimeError("This file does not contain any audio.")

    return torch.from_numpy(audio.T.copy())


def install_progress_hook():
    def tracked(futures, **_):
        total = len(futures)

        for index, future in enumerate(futures):
            yield future
            emit("progress", fraction=(index + 1) / total)

    demucs.apply.tqdm = types.SimpleNamespace(tqdm=tracked)


def run_model(model, audio, device):
    # reference: mono mixdown of the song, used to normalise loudness
    reference = audio.mean(0)
    mean = reference.mean()
    std = reference.std()

    # silent files have zero deviation, so keep the scale at 1
    scale = std if std > 0 else torch.tensor(1.0)

    normalised = (audio - mean) / scale

    sources = apply_model(
        model,
        normalised[None],
        device=device,
        shifts=1,
        split=True,
        overlap=0.25,
        progress=True,
    )[0]

    return sources * scale + mean


def separate(model, audio):
    device = "cuda" if torch.cuda.is_available() else "cpu"

    try:
        emit("stage", stage="separating", device=device)
        return run_model(model, audio, device), device
    except torch.cuda.OutOfMemoryError:
        torch.cuda.empty_cache()
        emit("stage", stage="separating", device="cpu")
        return run_model(model, audio, "cpu"), "cpu"


def write_stems(sources, names, output_dir):
    stems_dir = output_dir / "stems"
    stems_dir.mkdir(parents=True, exist_ok=True)

    # one shared gain for every stem, so they still add up to the original mix
    peak = float(sources.abs().max())
    gain = 1.0 / peak if peak > 1.0 else 1.0

    for source, name in zip(sources, names):
        samples = (source * gain).cpu().numpy().T.astype(np.float32)
        sf.write(stems_dir / f"{name}.wav", samples, SAMPLE_RATE, subtype="PCM_24")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    sys.stdout = sys.stderr
    args.output.mkdir(parents=True, exist_ok=True)

    emit("stage", stage="decoding")
    decoded_path = args.output / "decoded.wav"
    audio = decode_audio(args.input, decoded_path)

    emit("stage", stage="loading-model")
    install_progress_hook()
    model = get_model(MODEL_NAME)
    model.eval()

    with torch.no_grad():
        sources, device = separate(model, audio)

    emit("stage", stage="writing")
    write_stems(sources, model.sources, args.output)
    decoded_path.unlink()

    emit(
        "done",
        stems=list(model.sources),
        duration=audio.shape[1] / SAMPLE_RATE,
        device=device,
        model=MODEL_NAME,
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit("error", message=str(error))
        raise
