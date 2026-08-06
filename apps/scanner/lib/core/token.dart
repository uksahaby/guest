import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';

/// Pass token — Dart port of packages/checkin-core/src/token.ts.
///
/// This file and checkin.dart are the ONLY logic duplicated across
/// languages (the TS original's own rule). Port behaviour, not style;
/// the test cases ported with it are the specification.
///
/// Format:  `<pass>.<event>.<v>.<sig>`
/// UUIDs packed to 16 raw bytes, base64url (no padding), ~62 chars total.
/// Signature is HMAC-SHA256 truncated to 12 bytes.

class EventKey {
  final String eventId;
  final String eventName;
  final int tokenVersion;
  final List<int> key;
  const EventKey({
    required this.eventId,
    required this.eventName,
    required this.tokenVersion,
    required this.key,
  });
}

class TokenPayload {
  final String passId;
  final String eventId;
  final int tokenVersion;
  const TokenPayload({
    required this.passId,
    required this.eventId,
    required this.tokenVersion,
  });
}

sealed class VerifyResult {
  const VerifyResult();
  bool get ok => this is VerifyOk;
}

class VerifyOk extends VerifyResult {
  final TokenPayload payload;

  /// Which held key verified it — may not be the event being scanned.
  final EventKey matched;
  const VerifyOk({required this.payload, required this.matched});
}

/// reason: 'malformed' | 'no_key' | 'stale_version'
class VerifyFail extends VerifyResult {
  final String reason;
  const VerifyFail(this.reason);
}

final _uuidRe = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
  caseSensitive: false,
);

String _b64url(List<int> bytes) => base64Url.encode(bytes).replaceAll('=', '');

Uint8List _unb64url(String s) => base64Url.decode(base64Url.normalize(s));

String packUuid(String uuid) {
  if (!_uuidRe.hasMatch(uuid)) {
    throw ArgumentError('not a uuid: $uuid');
  }
  final hex = uuid.replaceAll('-', '').toLowerCase();
  final bytes = Uint8List(16);
  for (var i = 0; i < 16; i++) {
    bytes[i] = int.parse(hex.substring(i * 2, i * 2 + 2), radix: 16);
  }
  return _b64url(bytes);
}

String unpackUuid(String packed) {
  final b = _unb64url(packed);
  if (b.length != 16) throw ArgumentError('bad uuid packing');
  final h = b.map((x) => x.toRadixString(16).padLeft(2, '0')).join();
  return '${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-'
      '${h.substring(16, 20)}-${h.substring(20)}';
}

String _sign(String body, List<int> key) {
  final mac = Hmac(sha256, key).convert(utf8.encode(body));
  return _b64url(mac.bytes.sublist(0, 12));
}

String issueToken(TokenPayload p, List<int> key) {
  final body = '${packUuid(p.passId)}.${packUuid(p.eventId)}.${p.tokenVersion}';
  return '$body.${_sign(body, key)}';
}

bool _constantTimeEquals(List<int> a, List<int> b) {
  if (a.length != b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff == 0;
}

/// Tries every key the device holds, not just the current event's —
/// that is what turns "invalid" into "this pass is for Yusuf & Maryam".
VerifyResult verifyToken(String raw, List<EventKey> keys) {
  final parts = raw.trim().split('.');
  if (parts.length != 4) return const VerifyFail('malformed');

  final pass = parts[0], event = parts[1], verStr = parts[2], sig = parts[3];
  final body = '$pass.$event.$verStr';

  final TokenPayload payload;
  try {
    final version = int.parse(verStr);
    payload = TokenPayload(
      passId: unpackUuid(pass),
      eventId: unpackUuid(event),
      tokenVersion: version,
    );
  } catch (_) {
    return const VerifyFail('malformed');
  }

  final Uint8List given;
  try {
    given = _unb64url(sig);
  } catch (_) {
    return const VerifyFail('malformed');
  }
  if (given.length != 12) return const VerifyFail('malformed');

  for (final k in keys) {
    final expected = _unb64url(_sign(body, k.key));
    if (_constantTimeEquals(expected, given)) {
      // A pass reissue bumps token_version. Old codes stop working without
      // needing every one of them on a revocation list.
      if (payload.tokenVersion != k.tokenVersion) {
        return const VerifyFail('stale_version');
      }
      return VerifyOk(payload: payload, matched: k);
    }
  }
  return const VerifyFail('no_key');
}
