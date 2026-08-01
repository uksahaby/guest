"""Generates the gate's four cue sounds.

    python tool/make_sounds.py

Committed as WAV alongside this script so a build never depends on running
it, and so anyone can hear what changed in a diff by regenerating.

Design constraints, all of them from what a gate is actually like:

  * A Nigerian wedding gate is loud — a crowd, a generator, often a band.
    Cues sit between 600 Hz and 1.4 kHz, where speech does not mask them
    and small phone speakers are at their most efficient. The refusal is
    the exception: it is deliberately low and rough so it reads as "stop"
    even to someone who never learned what the sounds mean.

  * They must be distinguishable without looking, which means shape, not
    just pitch. Rising = go, flat repeated = wait, falling = no. Someone
    holding a queue at arm's length learns these in a minute and then
    never looks at the screen again.

  * Short. Anything past ~300 ms is still playing when the next guest is
    at the reticle, and a cue that overlaps the next scan is worse than
    silence because it attaches to the wrong person.

16-bit mono at 44.1 kHz: every Android device plays it without resampling.
"""

import math
import os
import struct
import wave

RATE = 44100
PEAK = 0.62  # loud enough over a crowd, short of the clipping small speakers do


def envelope(i: int, n: int, attack_ms: float = 4.0, release_ms: float = 18.0) -> float:
    """Fades each edge. A raw start or stop is a click, and a click at this
    volume is what makes a phone speaker sound broken."""
    attack = max(1, int(RATE * attack_ms / 1000))
    release = max(1, int(RATE * release_ms / 1000))
    if i < attack:
        return i / attack
    if i > n - release:
        return max(0.0, (n - i) / release)
    return 1.0


def tone(freq_from: float, ms: float, freq_to: float | None = None,
         harmonic: float = 0.0) -> list[float]:
    """One note. Sweeps when freq_to is given; `harmonic` adds a third
    partial, which is what turns a pure tone into something with an edge."""
    n = int(RATE * ms / 1000)
    out = []
    phase = 0.0
    for i in range(n):
        f = freq_from if freq_to is None else freq_from + (freq_to - freq_from) * (i / n)
        phase += 2 * math.pi * f / RATE
        v = math.sin(phase)
        if harmonic:
            v = (1 - harmonic) * v + harmonic * math.sin(3 * phase)
        out.append(v * envelope(i, n))
    return out


def silence(ms: float) -> list[float]:
    return [0.0] * int(RATE * ms / 1000)


def write(name: str, samples: list[float]) -> None:
    path = os.path.join("assets", "sounds", name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    peak = max((abs(s) for s in samples), default=1.0) or 1.0
    frames = b"".join(
        struct.pack("<h", int(max(-1.0, min(1.0, s / peak * PEAK)) * 32767))
        for s in samples
    )
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(frames)
    print(f"{path}  {len(samples) / RATE * 1000:.0f}ms  {len(frames) + 44} bytes")


# Admitted: two rising notes. The sound of a turnstile letting someone
# through — the usher hears it and is already looking at the next guest.
write("admit.wav", tone(784, 70) + tone(1175, 130))

# Pass valid, waiting for a count: one note, mid, unresolved on purpose.
# It asks a question, so it must not sound like the admit that follows it.
write("ask.wav", tone(988, 95))

# Amber. Two flat repeats — the universal "hold on", and the only cue with
# a gap in the middle, which is what makes it recognisable across a room.
write("hold.wav", tone(660, 85) + silence(55) + tone(660, 85))

# Refused. Low, falling and rough. Nothing else here is under 600 Hz, so it
# is unmistakable even at the edge of hearing it.
write("deny.wav", tone(320, 90, 190, harmonic=0.35) + tone(190, 170, 155, harmonic=0.35))
