// The gate's audible verdict.
//
// An usher working a queue looks at the guest, not the phone. Haptics were
// what shipped, and a buzz reaches nobody holding a handset at arm's length
// or resting it on a table — so the sound is the part that actually does
// the job, and the part worth pinning down.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:scanner/core/checkin.dart';
import 'package:scanner/ui/result_overlay.dart';
import 'package:scanner/ui/sounds.dart';

class FakeSounds implements GateSounds {
  final played = <Tone>[];
  bool warmed = false;
  bool _muted = false;

  @override
  bool get muted => _muted;

  @override
  Future<void> play(Tone tone) async {
    if (!_muted) played.add(tone);
  }

  @override
  Future<void> setMuted(bool value) async => _muted = value;

  @override
  Future<void> warmUp() async => warmed = true;
}

Decision _decision(Outcome outcome, Tone tone, {int? autoReturnMs}) => Decision(
  outcome: outcome,
  tone: tone,
  admittedCount: 0,
  headline: 'Mr & Mrs Adeyemi',
  log: true,
  autoReturnMs: autoReturnMs,
  actions: const ['Dismiss'],
);

const _needsCount = Decision(
  outcome: Outcome.needsCount,
  tone: Tone.ask,
  admittedCount: 0,
  headline: 'Mr & Mrs Adeyemi',
  remaining: 2,
  choices: [1, 2],
  log: false,
  autoReturnMs: null,
  actions: [],
);

const _admitted = Decision(
  outcome: Outcome.admitted,
  tone: Tone.admit,
  admittedCount: 2,
  headline: 'Mr & Mrs Adeyemi',
  log: true,
  autoReturnMs: 1500,
  actions: [],
);

/// Mirrors ScanScreen: one overlay whose decision is swapped in place.
class _Harness extends StatefulWidget {
  const _Harness();
  @override
  State<_Harness> createState() => _HarnessState();
}

class _HarnessState extends State<_Harness> {
  Decision _current = _needsCount;

  @override
  Widget build(BuildContext context) => MaterialApp(
    home: Scaffold(
      body: ResultOverlay(
        decision: _current,
        onClose: () {},
        onAdmitCount: (_) => setState(() => _current = _admitted),
      ),
    ),
  );
}

void main() {
  late FakeSounds sounds;
  late GateSounds real;

  setUp(() {
    real = GateSounds.instance;
    sounds = FakeSounds();
    GateSounds.instance = sounds;
  });

  tearDown(() => GateSounds.instance = real);

  Future<void> show(WidgetTester tester, Decision d) => tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: ResultOverlay(decision: d, onClose: () {}),
      ),
    ),
  );

  testWidgets('each verdict has its own cue', (tester) async {
    await show(
      tester,
      _decision(Outcome.admitted, Tone.admit, autoReturnMs: 1500),
    );
    expect(sounds.played, [Tone.admit]);
  });

  testWidgets('a refusal sounds different from an admission', (tester) async {
    await show(tester, _decision(Outcome.revoked, Tone.deny));
    expect(sounds.played, [Tone.deny]);
  });

  testWidgets('amber is its own cue, not the refusal one', (tester) async {
    await show(tester, _decision(Outcome.overflowBlocked, Tone.hold));
    expect(sounds.played, [Tone.hold]);
    // The hold haptic is two pulses 120ms apart; let the second one land
    // rather than leaving a timer pending at the end of the test.
    await tester.pump(const Duration(milliseconds: 200));
  });

  // The count picker is the case that matters most: two cues in one visit,
  // and the second one only happens because didUpdateWidget re-arms. Before
  // that fix the usher heard the question and never the answer.
  testWidgets('the count picker sounds twice — question, then answer', (
    tester,
  ) async {
    // A phone-shaped surface. The default 800x600 puts the confirm button
    // past the bottom edge, where a tap lands on whatever is behind it.
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 3.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(const _Harness());
    expect(sounds.played, [Tone.ask]);

    await tester.tap(find.text('Admit 2'));
    await tester.pump();

    expect(
      sounds.played,
      [Tone.ask, Tone.admit],
      reason: 'admitting from the picker must be heard, not just seen',
    );

    await tester.pump(const Duration(milliseconds: 1600));
  });

  testWidgets('muted means silent, and stays that way', (tester) async {
    await sounds.setMuted(true);

    await show(
      tester,
      _decision(Outcome.admitted, Tone.admit, autoReturnMs: 1500),
    );
    expect(sounds.played, isEmpty);

    await sounds.setMuted(false);
    await show(tester, _decision(Outcome.revoked, Tone.deny));
    expect(sounds.played, [Tone.deny]);
  });
}
