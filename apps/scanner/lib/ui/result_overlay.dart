import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/checkin.dart';
import 'theme.dart';

/// The result screen for every scan outcome, per design/mockups/scanner.html
/// and phase-4c §4–5:
///
///  · the guest's NAME is the largest element; the status eyebrow is small —
///    colour, sound and haptic already carried the verdict
///  · green outcomes auto-return to the camera; amber and red wait for a
///    human, because a refusal means a conversation is happening at the gate
///  · needs_count shows the picker pre-selected at the full remaining count,
///    so the usual case stays one tap
class ResultOverlay extends StatefulWidget {
  final Decision decision;

  /// Called when the overlay wants to close (auto-return or Dismiss).
  final VoidCallback onClose;

  /// needs_count confirm: admit [count] people.
  final void Function(int count)? onAdmitCount;

  /// Undo the admission just written.
  final VoidCallback? onUndo;

  /// 'Admit anyway' / 'Call manager' / 'Search by name' / 'Add walk-in'.
  final void Function(String action)? onAction;

  const ResultOverlay({
    super.key,
    required this.decision,
    required this.onClose,
    this.onAdmitCount,
    this.onUndo,
    this.onAction,
  });

  @override
  State<ResultOverlay> createState() => _ResultOverlayState();
}

class _ResultOverlayState extends State<ResultOverlay> {
  Timer? _autoReturn;
  late int _picked;

  Decision get d => widget.decision;

  @override
  void initState() {
    super.initState();
    _arrive();
  }

  /// Found at a real gate: admitting from the count picker left the overlay
  /// up forever, saying "Returning to camera" with nothing to return it.
  ///
  /// A needs_count result is replaced in place by the admitted one — same
  /// widget, same position — so Flutter keeps this State and initState does
  /// not run a second time. The timer, the haptic and the picker default
  /// all lived there, so none of them happened for the outcome the usher
  /// actually ends on. Every scan after it was ignored, because the screen
  /// behind is guarded on a result being present.
  ///
  /// A plain admit never showed it: that overlay is built fresh.
  @override
  void didUpdateWidget(covariant ResultOverlay old) {
    super.didUpdateWidget(old);
    if (!identical(old.decision, widget.decision)) {
      _autoReturn?.cancel();
      _arrive();
    }
  }

  /// Everything a newly shown result does, whether it is the first or the
  /// third in one visit.
  void _arrive() {
    _picked = d.remaining != null && d.remaining! > 0 ? d.remaining! : 1;
    _feedback();
    final ms = d.autoReturnMs;
    _autoReturn = ms == null
        ? null
        : Timer(Duration(milliseconds: ms), widget.onClose);
  }

  @override
  void dispose() {
    _autoReturn?.cancel();
    super.dispose();
  }

  /// Phase-4c §5: distinguishable without looking. (Tones are v2 — haptics
  /// carry the split for now.)
  void _feedback() {
    switch (d.tone) {
      case Tone.admit:
        HapticFeedback.lightImpact();
      case Tone.ask:
        HapticFeedback.lightImpact();
      case Tone.hold:
        HapticFeedback.mediumImpact();
        Future.delayed(const Duration(milliseconds: 120),
            HapticFeedback.mediumImpact);
      case Tone.deny:
        HapticFeedback.vibrate();
    }
  }

  Color get _accent => switch (d.tone) {
        Tone.admit => Palette.admit,
        Tone.ask => Palette.admit,
        Tone.hold => Palette.hold,
        Tone.deny => Palette.deny,
      };

  Color get _wash => switch (d.tone) {
        Tone.admit => Palette.admitWash,
        Tone.ask => Palette.surface,
        Tone.hold => Palette.holdWash,
        Tone.deny => Palette.denyWash,
      };

  String get _glyph => switch (d.tone) {
        Tone.admit => '✓',
        Tone.ask => '✓',
        Tone.hold => '!',
        Tone.deny => '✕',
      };

  String get _eyebrow => switch (d.outcome) {
        Outcome.admitted => 'Admitted',
        Outcome.partial => 'Partly admitted',
        Outcome.manual => 'Checked in by hand',
        Outcome.overflowAdmitted => 'Over allowance',
        Outcome.needsCount => 'Pass valid',
        Outcome.allowanceExhausted => 'Party fully admitted',
        Outcome.rsvpBlocked => 'No RSVP on file',
        Outcome.rsvpDeclined => 'They replied no',
        Outcome.revoked => 'Pass revoked',
        Outcome.wrongEvent => 'Pass is for another event',
        Outcome.wrongLeg => 'Not invited to this one',
        Outcome.invalid => 'Not a valid pass',
        Outcome.overflowBlocked => 'More people than invited',
        Outcome.eventCancelled => 'Event cancelled',
        Outcome.notFound => 'No matching guest',
      };

  @override
  Widget build(BuildContext context) {
    final inv = d.invitation;
    return Container(
      color: _wash,
      padding: const EdgeInsets.fromLTRB(22, 26, 22, 22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            height: 5,
            decoration: BoxDecoration(
              color: _accent,
              borderRadius: BorderRadius.circular(3),
            ),
          ),
          const SizedBox(height: 26),
          Row(children: [
            Container(
              width: 21,
              height: 21,
              decoration: BoxDecoration(color: _accent, shape: BoxShape.circle),
              alignment: Alignment.center,
              child: Text(_glyph,
                  style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: Palette.ground,
                      height: 1)),
            ),
            const SizedBox(width: 9),
            Text(
              _eyebrow.toUpperCase(),
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                letterSpacing: 1.5,
                color: _accent,
              ),
            ),
          ]),
          const SizedBox(height: 16),
          // The name the usher is about to say aloud — largest thing here.
          Text(
            d.outcome == Outcome.needsCount
                ? d.headline
                : (inv?.displayName ?? d.headline),
            style: const TextStyle(
              fontSize: 35,
              fontWeight: FontWeight.w600,
              letterSpacing: -1.2,
              height: 1.05,
              color: Palette.text,
            ),
          ),
          if (d.detail != null) ...[
            const SizedBox(height: 11),
            Text(d.detail!,
                style: const TextStyle(
                    fontSize: 14.5, color: Palette.muted, height: 1.55)),
          ],
          if (inv?.tableName != null && d.outcome != Outcome.needsCount) ...[
            const SizedBox(height: 18),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: .07),
                border:
                    Border.all(color: Colors.white.withValues(alpha: .1)),
                borderRadius: BorderRadius.circular(11),
              ),
              child: Text(inv!.tableName!,
                  style: const TextStyle(
                      fontSize: 20, fontWeight: FontWeight.w600)),
            ),
          ],
          if (d.outcome == Outcome.needsCount) _picker(),
          const Spacer(),
          if (d.autoReturnMs != null)
            Row(children: [
              Container(
                width: 5,
                height: 5,
                decoration:
                    const BoxDecoration(color: Palette.admit, shape: BoxShape.circle),
              ),
              const SizedBox(width: 9),
              const Text('Returning to camera',
                  style: TextStyle(fontSize: 12.5, color: Palette.muted)),
              const Spacer(),
              if (widget.onUndo != null)
                TextButton(
                    onPressed: () {
                      _autoReturn?.cancel();
                      widget.onUndo!();
                      widget.onClose();
                    },
                    child: const Text('Undo',
                        style: TextStyle(color: Palette.text))),
            ])
          else if (d.outcome == Outcome.needsCount)
            _confirmButton()
          else
            _actions(),
        ],
      ),
    );
  }

  Widget _picker() {
    final choices = d.choices ?? const [1];
    return Padding(
      padding: const EdgeInsets.only(top: 24),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('How many arrived?',
            style: TextStyle(fontSize: 14.5, color: Palette.muted)),
        const SizedBox(height: 12),
        Row(children: [
          for (final n in choices) ...[
            Expanded(
              child: AspectRatio(
                aspectRatio: 1,
                child: _num(n, selected: n == _picked),
              ),
            ),
            if (n != choices.last) const SizedBox(width: 9),
          ],
        ]),
      ]),
    );
  }

  Widget _num(int n, {required bool selected}) => Material(
        color: selected ? Palette.admit : Colors.transparent,
        borderRadius: BorderRadius.circular(14),
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: () => setState(() => _picked = n),
          child: Container(
            alignment: Alignment.center,
            decoration: BoxDecoration(
              border: Border.all(
                  color: selected
                      ? Palette.admit
                      : Colors.white.withValues(alpha: .14),
                  width: 1.5),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Text('$n',
                style: TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.w600,
                    color: selected ? Palette.ground : Palette.text)),
          ),
        ),
      );

  Widget _confirmButton() => SizedBox(
        width: double.infinity,
        child: FilledButton(
          style: FilledButton.styleFrom(
            backgroundColor: Palette.text,
            foregroundColor: Palette.ground,
            padding: const EdgeInsets.symmetric(vertical: 16),
            shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(13)),
          ),
          onPressed: () => widget.onAdmitCount?.call(_picked),
          child: Text('Admit $_picked',
              style:
                  const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
        ),
      );

  Widget _actions() => Row(children: [
        for (final a in d.actions) ...[
          Expanded(
            child: OutlinedButton(
              style: OutlinedButton.styleFrom(
                foregroundColor:
                    a == 'Admit anyway' ? Palette.ground : Palette.text,
                backgroundColor:
                    a == 'Admit anyway' ? Palette.hold : Colors.transparent,
                side: BorderSide(color: Colors.white.withValues(alpha: .14)),
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(13)),
              ),
              onPressed: () {
                if (a == 'Dismiss') {
                  widget.onClose();
                } else {
                  widget.onAction?.call(a);
                }
              },
              child: Text(a,
                  style: const TextStyle(
                      fontSize: 15, fontWeight: FontWeight.w600)),
            ),
          ),
          if (a != d.actions.last) const SizedBox(width: 10),
        ],
      ]);
}
