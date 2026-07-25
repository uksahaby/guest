import 'token.dart';

/// The check-in state machine — Dart port of
/// packages/checkin-core/src/checkin.ts.
///
/// Deliberately pure: no database, no clock, no network. Everything it
/// needs arrives in the context — which is what lets identical logic run
/// on a phone with no signal and on the server when the queue syncs.
///
/// The ported test suite is the specification. Behaviour must match the
/// TypeScript original exactly; if they ever disagree, both are wrong.

enum Rsvp { pending, attending, partial, declined }

enum Outcome {
  needsCount('needs_count'),
  admitted('admitted'),
  partial('partial'),
  overflowAdmitted('overflow_admitted'),
  manual('manual'),
  allowanceExhausted('allowance_exhausted'),
  invalid('invalid'),
  wrongEvent('wrong_event'),
  wrongLeg('wrong_leg'),
  revoked('revoked'),
  rsvpBlocked('rsvp_blocked'),
  rsvpDeclined('rsvp_declined'),
  overflowBlocked('overflow_blocked'),
  notFound('not_found');

  /// The string written to check_in_events.result on the server.
  final String wire;
  const Outcome(this.wire);
}

enum Tone { admit, hold, deny, ask }

/// One household's row in the scanner's local copy of the guest list.
class LocalInvitation {
  final String passId;
  final String invitationId;
  final String eventId;
  final String legId;
  final String displayName;
  final String? category;
  final String? tableName;
  final int allowance;

  /// Derived locally: SUM(admitted_count) for this pass at this leg.
  final int admitted;
  final Rsvp rsvp;
  final bool revoked;

  const LocalInvitation({
    required this.passId,
    required this.invitationId,
    required this.eventId,
    required this.legId,
    required this.displayName,
    this.category,
    this.tableName,
    required this.allowance,
    required this.admitted,
    required this.rsvp,
    required this.revoked,
  });
}

class Policy {
  final bool allowOverflow;
  final bool requireRsvp;
  const Policy({required this.allowOverflow, required this.requireRsvp});
}

class Context {
  final String currentEventId;
  final String currentLegId;
  final Policy policy;

  /// Keys for every event this usher works, not only the current one.
  final List<EventKey> keys;

  /// Local lookup by pass id. Null means not in this leg's list.
  final LocalInvitation? Function(String passId) find;

  /// Usher permission. Off by default.
  final bool canOverrideRsvp;

  const Context({
    required this.currentEventId,
    required this.currentLegId,
    required this.policy,
    required this.keys,
    required this.find,
    this.canOverrideRsvp = false,
  });
}

sealed class ScanInput {
  final int? requestedCount;
  const ScanInput(this.requestedCount);
}

class ScanRaw extends ScanInput {
  final String raw;
  const ScanRaw(this.raw, {int? requestedCount}) : super(requestedCount);
}

/// Name search, then check in by hand. Skips all token checks.
class ManualInput extends ScanInput {
  final String passId;
  const ManualInput(this.passId, {int? requestedCount}) : super(requestedCount);
}

class Decision {
  final Outcome outcome;
  final Tone tone;

  /// Counts against allowance. Zero for every refusal.
  final int admittedCount;
  final String headline;
  final String? detail;

  /// Household, when we could identify one.
  final LocalInvitation? invitation;

  /// Remaining after this decision is applied.
  final int? remaining;

  /// Present on needs_count — what the picker should offer.
  final List<int>? choices;

  /// Whether to write a row. Refusals are logged; the count prompt is not.
  final bool log;

  /// Milliseconds before returning to the camera. Null = wait for a human.
  final int? autoReturnMs;

  /// Offered under the result.
  final List<String> actions;

  const Decision({
    required this.outcome,
    required this.tone,
    required this.admittedCount,
    required this.headline,
    this.detail,
    this.invitation,
    this.remaining,
    this.choices,
    required this.log,
    required this.autoReturnMs,
    required this.actions,
  });
}

const _admitDwell = 1500;
const _partialDwell = 2500;

Decision _deny(
  Outcome outcome,
  String headline,
  String? detail,
  List<String> actions,
) =>
    Decision(
      outcome: outcome,
      tone: Tone.deny,
      admittedCount: 0,
      headline: headline,
      detail: detail,
      log: true,
      autoReturnMs: null,
      actions: actions,
    );

Decision _hold(
  Outcome outcome,
  String headline,
  String? detail,
  List<String> actions, [
  LocalInvitation? invitation,
]) =>
    Decision(
      outcome: outcome,
      tone: Tone.hold,
      admittedCount: 0,
      headline: headline,
      detail: detail,
      invitation: invitation,
      log: true,
      autoReturnMs: null,
      actions: actions,
    );

Decision decide(Context ctx, ScanInput input) {
  LocalInvitation? inv;

  switch (input) {
    case ScanRaw(:final raw):
      // ---- 1. decode + signature, against every held key -----------------
      final v = verifyToken(raw, ctx.keys);

      if (v is VerifyFail) {
        if (v.reason == 'stale_version') {
          return _deny(
            Outcome.revoked,
            'Pass no longer valid',
            'This code was replaced. The guest needs their new link.',
            ['Search by name', 'Dismiss'],
          );
        }
        return _deny(
          Outcome.invalid,
          'Not a valid pass',
          "The code didn't verify. It may be a screenshot of something else, or damaged.",
          ['Search by name', 'Dismiss'],
        );
      }

      final ok = v as VerifyOk;

      // ---- 2. right event? ------------------------------------------------
      if (ok.payload.eventId != ctx.currentEventId) {
        return _deny(
          Outcome.wrongEvent,
          'Pass is for another event',
          'This pass belongs to ${ok.matched.eventName}.',
          ['Dismiss'],
        );
      }

      // ---- 3. on this leg's list? -----------------------------------------
      inv = ctx.find(ok.payload.passId);
      if (inv == null) {
        // Genuine pass for this event, but not invited to the leg being
        // scanned — the Abuja list at the Lagos gate.
        return _deny(
          Outcome.wrongLeg,
          'Not invited to this one',
          'This pass is for a different part of the event.',
          ['Search by name', 'Dismiss'],
        );
      }

    case ManualInput(:final passId):
      inv = ctx.find(passId);
      if (inv == null) {
        return _deny(
          Outcome.notFound,
          'No matching guest',
          'Nothing on the list for this event.',
          ['Add walk-in', 'Dismiss'],
        );
      }
  }

  // ---- 4. revoked --------------------------------------------------------
  if (inv.revoked) {
    return _deny(
      Outcome.revoked,
      'Pass revoked',
      '${inv.displayName} was removed from the guest list.',
      ['Call manager', 'Dismiss'],
    );
  }

  // ---- 5. RSVP gate ------------------------------------------------------
  if (inv.rsvp == Rsvp.declined) {
    return _hold(
      Outcome.rsvpDeclined,
      'They replied no',
      '${inv.displayName} declined this invitation.',
      ctx.canOverrideRsvp
          ? ['Admit anyway', 'Dismiss']
          : ['Call manager', 'Dismiss'],
      inv,
    );
  }
  if (ctx.policy.requireRsvp && inv.rsvp == Rsvp.pending) {
    return _hold(
      Outcome.rsvpBlocked,
      'No reply on file',
      'This event requires an RSVP before entry.',
      ctx.canOverrideRsvp
          ? ['Admit anyway', 'Dismiss']
          : ['Call manager', 'Dismiss'],
      inv,
    );
  }

  // ---- 6. allowance ------------------------------------------------------
  final remaining =
      (inv.allowance - inv.admitted) < 0 ? 0 : inv.allowance - inv.admitted;

  if (remaining == 0 && !ctx.policy.allowOverflow) {
    return _hold(
      Outcome.allowanceExhausted,
      'Party fully admitted',
      '${inv.admitted} of ${inv.allowance} already in.',
      ['Call manager', 'Dismiss'],
      inv,
    );
  }

  // ---- 7. how many arrived? ---------------------------------------------
  final asked = input.requestedCount;

  if (asked == null) {
    // Allowance of one needs no prompt. This is most guests, and this path
    // must never gain a tap.
    if (inv.allowance == 1 && remaining == 1) {
      return _applyAdmission(ctx, inv, 1, input, remaining);
    }
    if (remaining == 0) {
      // Overflow is allowed, so offer it rather than refusing outright.
      return Decision(
        outcome: Outcome.needsCount,
        tone: Tone.ask,
        admittedCount: 0,
        headline: inv.displayName,
        detail:
            '${inv.admitted} of ${inv.allowance} already admitted. Anyone else is over the invitation.',
        invitation: inv,
        remaining: 0,
        choices: const [1, 2, 3],
        log: false,
        autoReturnMs: null,
        actions: const [],
      );
    }
    final parts = [inv.category, inv.tableName].whereType<String>().join(' · ');
    return Decision(
      outcome: Outcome.needsCount,
      tone: Tone.ask,
      admittedCount: 0,
      headline: inv.displayName,
      detail: parts.isEmpty ? null : parts,
      invitation: inv,
      remaining: remaining,
      // Pre-selected at the full remaining count by the UI, so the common
      // case stays one tap.
      choices: List<int>.generate(remaining, (i) => i + 1),
      log: false,
      autoReturnMs: null,
      actions: const [],
    );
  }

  if (asked < 1) {
    return _deny(
      Outcome.invalid,
      'Nothing to admit',
      'Count must be at least one.',
      ['Dismiss'],
    );
  }

  return _applyAdmission(ctx, inv, asked, input, remaining);
}

Decision _applyAdmission(
  Context ctx,
  LocalInvitation inv,
  int count,
  ScanInput kind,
  int remaining,
) {
  final over = (count - remaining) < 0 ? 0 : count - remaining;

  if (over > 0 && !ctx.policy.allowOverflow) {
    return _deny(
      Outcome.overflowBlocked,
      'More people than invited',
      'Invited for ${inv.allowance}, ${inv.admitted + count} would be in. A manager must raise the invitation.',
      ['Call manager', 'Dismiss'],
    );
  }

  final afterRaw = inv.allowance - (inv.admitted + count);
  final after = afterRaw < 0 ? 0 : afterRaw;

  if (over > 0) {
    return Decision(
      outcome: Outcome.overflowAdmitted,
      tone: Tone.hold,
      admittedCount: count,
      headline: '$count admitted · $over over',
      detail:
          '${inv.displayName} was invited for ${inv.allowance}. The organiser has been notified.',
      invitation: inv,
      remaining: 0,
      log: true,
      autoReturnMs: _partialDwell,
      actions: const ['Undo'],
    );
  }

  final isManual = kind is ManualInput;
  final outcome = isManual
      ? Outcome.manual
      : count < remaining
          ? Outcome.partial
          : Outcome.admitted;

  final partial = after > 0;

  return Decision(
    outcome: outcome,
    tone: Tone.admit,
    admittedCount: count,
    headline: partial
        ? '$count of ${inv.allowance} admitted'
        : isManual
            ? 'Checked in by hand'
            : 'Admitted',
    detail: [inv.displayName, inv.tableName].whereType<String>().join(' · '),
    invitation: inv,
    remaining: after,
    log: true,
    // Longer when there is a number to read.
    autoReturnMs: partial ? _partialDwell : _admitDwell,
    actions: const ['Undo'],
  );
}
