// Pulling the token out of whatever an usher pasted.
//
// The realistic input is not a bare token. The organiser sends a WhatsApp
// message with a sentence wrapped around a link, and the usher long-presses
// and hits Copy, which takes the whole line. Asking them to select exactly
// the 43 characters after /join/ on a phone keyboard, at a gate, in the
// dark, is not a thing that will happen — so the field accepts the message.
import 'package:flutter_test/flutter_test.dart';
import 'package:scanner/ui/login_screen.dart';

// A real token: 32 random bytes, base64url. Includes - and _ deliberately.
const _token = 'k3Jd-9xQvL2mNpR7sT4uWyZ_aBcDeFgHiJkLmNoPqRs';

void main() {
  test('a bare token survives untouched', () {
    expect(extractInviteToken(_token), _token);
  });

  test('a plain link gives up its last segment', () {
    expect(extractInviteToken('https://guest.vercel.app/join/$_token'), _token);
  });

  test('the whole WhatsApp message works', () {
    final pasted =
        "You're on the gate for this event. Tap to start checking guests "
        'in: https://guest.vercel.app/join/$_token';
    expect(extractInviteToken(pasted), _token);
  });

  test('surrounding whitespace and newlines do not matter', () {
    expect(
      extractInviteToken('  \n https://guest.vercel.app/join/$_token \n '),
      _token,
    );
  });

  test('a trailing full stop is not part of the token', () {
    expect(
      extractInviteToken('Tap here: https://guest.vercel.app/join/$_token.'),
      _token,
    );
  });

  test('a query string is dropped', () {
    expect(
      extractInviteToken('https://guest.vercel.app/join/$_token?utm=whatsapp'),
      _token,
    );
  });

  test('http and https are both fine', () {
    expect(extractInviteToken('http://10.0.2.2:3000/join/$_token'), _token);
  });

  test('empty input yields empty, not a crash', () {
    expect(extractInviteToken(''), '');
    expect(extractInviteToken('   '), '');
  });

  test('a link with no /join/ falls back to the last path segment', () {
    expect(extractInviteToken('https://example.com/$_token'), _token);
  });

  // The screen refuses anything under 20 characters, matching the API, so
  // this only has to not throw — it must not silently produce something
  // token-shaped out of prose.
  test('prose does not become a plausible token', () {
    expect(extractInviteToken('hello').length, lessThan(20));
  });
}
