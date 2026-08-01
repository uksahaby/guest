// The overlay's second life.
//
// Found at a real gate, not here: scanning a household pass shows the count
// picker, and admitting from it replaced the decision in place rather than
// building a new overlay. Flutter keeps the State across that swap, so
// initState — which held the auto-return timer — never ran for the outcome
// the usher actually ends on. The screen sat on "Returning to camera"
// forever, and because the scan screen ignores detections while a result is
// up, the gate stopped working until someone left and came back.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:scanner/core/checkin.dart';
import 'package:scanner/ui/result_overlay.dart';

const _needsCount = Decision(
  outcome: Outcome.needsCount,
  tone: Tone.ask,
  admittedCount: 0,
  headline: 'Mr & Mrs Adeyemi',
  remaining: 3,
  choices: [1, 2, 3],
  log: false,
  autoReturnMs: null, // waits for a human, correctly
  actions: [],
);

const _admitted = Decision(
  outcome: Outcome.admitted,
  tone: Tone.admit,
  admittedCount: 3,
  headline: 'Mr & Mrs Adeyemi',
  log: true,
  autoReturnMs: 1500,
  actions: [],
);

/// Mirrors ScanScreen: one overlay whose decision is swapped in place.
class _Harness extends StatefulWidget {
  final VoidCallback onClose;
  const _Harness({required this.onClose});

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
            onClose: widget.onClose,
            onAdmitCount: (_) => setState(() => _current = _admitted),
          ),
        ),
      );
}

void main() {
  testWidgets('admitting from the count picker returns to the camera',
      (tester) async {
    var closed = false;
    await tester.pumpWidget(_Harness(onClose: () => closed = true));

    expect(find.text('Admit 3'), findsOneWidget,
        reason: 'the picker defaults to the full remaining count');

    await tester.tap(find.text('Admit 3'));
    await tester.pump();

    expect(find.text('ADMITTED'), findsOneWidget);
    expect(closed, isFalse, reason: 'not instantly — the usher reads the name');

    await tester.pump(const Duration(milliseconds: 1600));
    expect(closed, isTrue,
        reason: 'the admitted result must hand the gate back on its own');
  });

  testWidgets('a plain admitted result still auto-returns', (tester) async {
    var closed = false;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: ResultOverlay(
          decision: _admitted,
          onClose: () => closed = true,
        ),
      ),
    ));

    await tester.pump(const Duration(milliseconds: 1600));
    expect(closed, isTrue);
  });

  testWidgets('a refusal waits for a human and never times out',
      (tester) async {
    var closed = false;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: ResultOverlay(
          decision: const Decision(
            outcome: Outcome.revoked,
            tone: Tone.deny,
            admittedCount: 0,
            headline: 'Pass revoked',
            log: true,
            autoReturnMs: null,
            actions: ['Dismiss'],
          ),
          onClose: () => closed = true,
        ),
      ),
    ));

    await tester.pump(const Duration(seconds: 10));
    expect(closed, isFalse,
        reason: 'a refusal means a conversation is happening at the gate');
  });
}
