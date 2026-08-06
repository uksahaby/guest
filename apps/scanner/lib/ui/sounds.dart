import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../core/checkin.dart';

/// The gate's audible verdict.
///
/// Phase-4c §5 asked for cues "distinguishable without looking" and only
/// haptics shipped. Haptics are the wrong instrument here: the phone is
/// held at arm's length pointing at a pass, often in one hand, sometimes
/// resting on a table, and a buzz is felt by nobody in that posture. An
/// usher facing a queue cannot read a screen either. Sound is the only
/// channel that reaches them while they are looking at a guest.
///
/// Four cues, one per tone, shaped so they differ by contour rather than
/// pitch alone — rising for admitted, flat repeats for wait, falling and
/// rough for refused. The shapes are the point: pitch alone stops working
/// across a crowd and a cheap speaker.
abstract class GateSounds {
  /// Swapped in tests. Nothing else should assign to this.
  static GateSounds instance = _RealSounds();

  Future<void> play(Tone tone);

  /// Silence for a ceremony, where a chime during vows is worse than
  /// looking at the screen. Survives a restart.
  bool get muted;
  Future<void> setMuted(bool value);

  /// Warms the player so the first guest of the day is not the one who
  /// waits for a codec to initialise.
  Future<void> warmUp();
}

class _RealSounds implements GateSounds {
  static const _key = 'gate_sounds_muted';
  static const _storage = FlutterSecureStorage();

  /// One player per cue. A single shared player cuts the previous sound
  /// off mid-note when two guests are scanned back to back, and a clipped
  /// cue is heard as a different cue.
  final _players = <Tone, AudioPlayer>{};

  bool _muted = false;
  bool _ready = false;

  @override
  bool get muted => _muted;

  static const _assets = {
    Tone.admit: 'sounds/admit.wav',
    Tone.ask: 'sounds/ask.wav',
    Tone.hold: 'sounds/hold.wav',
    Tone.deny: 'sounds/deny.wav',
  };

  @override
  Future<void> warmUp() async {
    if (_ready) return;
    _ready = true;

    // Not a secret; it is simply the key-value store this app already
    // carries, and one bool did not justify another dependency.
    _muted = (await _storage.read(key: _key)) == 'true';

    for (final entry in _assets.entries) {
      final player = AudioPlayer()..setReleaseMode(ReleaseMode.stop);
      // Sonification, not media: Android then ducks music rather than
      // pausing it, and the cue is not treated as something to resume.
      await player.setAudioContext(
        AudioContext(
          android: const AudioContextAndroid(
            isSpeakerphoneOn: false,
            stayAwake: false,
            contentType: AndroidContentType.sonification,
            usageType: AndroidUsageType.assistanceSonification,
            audioFocus: AndroidAudioFocus.gainTransientMayDuck,
          ),
          iOS: AudioContextIOS(
            category: AVAudioSessionCategory.playback,
            options: const {AVAudioSessionOptions.mixWithOthers},
          ),
        ),
      );
      await player.setSource(AssetSource(entry.value));
      _players[entry.key] = player;
    }
  }

  @override
  Future<void> play(Tone tone) async {
    if (_muted) return;
    await warmUp();
    final player = _players[tone];
    if (player == null) return;
    try {
      await player.seek(Duration.zero);
      await player.resume();
    } catch (_) {
      // A gate never stops for a speaker. Haptics and the screen still
      // carry the verdict, and a phone with no working audio route is
      // not a reason to refuse a guest.
    }
  }

  @override
  Future<void> setMuted(bool value) async {
    _muted = value;
    await _storage.write(key: _key, value: value ? 'true' : 'false');
    if (value) {
      for (final p in _players.values) {
        try {
          await p.stop();
        } catch (_) {}
      }
    }
  }
}

/// Haptics alongside the sound, unchanged in meaning: two pulses for hold,
/// a long buzz for a refusal. They are the fallback when the phone is
/// muted, in a pocket, or plugged into a venue's PA that nobody has turned
/// up yet.
void gateHaptic(Tone tone) {
  switch (tone) {
    case Tone.admit:
    case Tone.ask:
      HapticFeedback.lightImpact();
    case Tone.hold:
      HapticFeedback.mediumImpact();
      Future.delayed(
        const Duration(milliseconds: 120),
        HapticFeedback.mediumImpact,
      );
    case Tone.deny:
      HapticFeedback.vibrate();
  }
}
