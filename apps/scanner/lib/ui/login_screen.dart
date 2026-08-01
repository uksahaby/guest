import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../api/client.dart';
import 'theme.dart';

/// Sign-in for an usher.
///
/// Two ways in, and the order matters. The invite link the organiser sends
/// over WhatsApp is the ordinary path: it needs no SMS provider, no password
/// and nothing for casual staff to remember or lose. Sending a code by SMS
/// costs real money per usher and stops working the moment a Termii key is
/// missing, so it sits behind a link rather than in front.
///
/// The same invite token works in a browser. Whichever surface the usher
/// reaches first wins, and the other says the link is spent — which is what
/// single-use means and is worth the small confusion it can cause.
class LoginScreen extends StatefulWidget {
  final ApiClient api;
  final VoidCallback onSignedIn;
  const LoginScreen({super.key, required this.api, required this.onSignedIn});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

/// Pulls the token out of whatever the usher pasted.
///
/// They will paste the whole WhatsApp message as often as they paste the
/// bare code, and the difference is not something to make them care about.
/// Anything that looks like a URL gives up its last path segment; anything
/// else is taken as the token itself.
String extractInviteToken(String input) {
  var text = input.trim();
  if (text.isEmpty) return '';

  // A pasted WhatsApp line is "…check guests in: https://…/join/TOKEN".
  final match = RegExp(r'https?://\S+').firstMatch(text);
  if (match != null) text = match.group(0)!;

  if (text.contains('/join/')) {
    text = text.split('/join/').last;
  } else if (text.startsWith('http')) {
    final segments = Uri.tryParse(text)?.pathSegments ?? const [];
    if (segments.isNotEmpty) text = segments.last;
  }

  // Trailing punctuation from a copied sentence, and any query string.
  text = text.split('?').first.split('#').first;
  return text.replaceAll(RegExp(r'[^A-Za-z0-9_-]+$'), '');
}

class _LoginScreenState extends State<LoginScreen> {
  final _invite = TextEditingController();
  final _phone = TextEditingController(text: '+234');
  final _code = TextEditingController();
  final _storage = const FlutterSecureStorage();

  /// False is the invite path; true drops to phone-and-code.
  bool _bySms = false;
  bool _codeSent = false;
  bool _busy = false;
  String? _error;
  String? _devCode;

  Future<void> _remember() async {
    await _storage.write(key: 'jwt', value: widget.api.token);
    widget.onSignedIn();
  }

  Future<void> _run(Future<void> Function() body) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await body();
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = "Couldn't reach $apiUrl");
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _acceptInvite() => _run(() async {
        final token = extractInviteToken(_invite.text);
        if (token.length < 20) {
          setState(() => _error = "That doesn't look like a sign-in link.");
          return;
        }
        await widget.api.acceptInvite(token);
        await _remember();
      });

  Future<void> _request() => _run(() async {
        final res = await widget.api.requestOtp(_phone.text.trim());
        setState(() {
          _codeSent = true;
          // Dev servers return the code so the flow is testable end to end.
          _devCode = res['dev_code'] as String?;
        });
      });

  Future<void> _verify() => _run(() async {
        await widget.api.verifyOtp(_phone.text.trim(), _code.text.trim());
        await _remember();
      });

  @override
  void dispose() {
    _invite.dispose();
    _phone.dispose();
    _code.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(26),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 48),
              const Text('Sign in to check guests in',
                  style: TextStyle(
                      fontSize: 26,
                      fontWeight: FontWeight.w600,
                      letterSpacing: -.5)),
              const SizedBox(height: 8),
              Text(
                _subtitle(),
                style: const TextStyle(fontSize: 14.5, color: Palette.muted),
              ),
              const SizedBox(height: 28),
              ..._fields(),
              if (_error != null) ...[
                const SizedBox(height: 12),
                Text(_error!,
                    style: const TextStyle(color: Palette.deny, fontSize: 13.5)),
              ],
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  style: FilledButton.styleFrom(
                    backgroundColor: Palette.admit,
                    foregroundColor: Palette.ground,
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(13)),
                  ),
                  onPressed: _busy ? null : _primaryAction,
                  child: Text(_primaryLabel(),
                      style: const TextStyle(
                          fontSize: 15, fontWeight: FontWeight.w600)),
                ),
              ),
              if (_bySms && _codeSent)
                TextButton(
                  onPressed: _busy ? null : _request,
                  child: const Text('Resend code',
                      style: TextStyle(color: Palette.muted)),
                ),
              const SizedBox(height: 6),
              TextButton(
                onPressed: _busy
                    ? null
                    : () => setState(() {
                          _bySms = !_bySms;
                          _codeSent = false;
                          _error = null;
                        }),
                child: Text(
                  _bySms
                      ? 'I have a sign-in link instead'
                      : 'I have no link — send me a code',
                  style: const TextStyle(color: Palette.muted),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _subtitle() {
    if (!_bySms) {
      return 'Paste the sign-in link the organiser sent you on WhatsApp. '
          'It works once.';
    }
    return _codeSent
        ? 'Enter the six-digit code we sent to ${_phone.text}.'
        : 'Your phone number is your login. Only works if the organiser '
            'set up text messages.';
  }

  String _primaryLabel() {
    if (!_bySms) return 'Sign in';
    return _codeSent ? 'Sign in' : 'Send code';
  }

  void _primaryAction() {
    if (!_bySms) {
      _acceptInvite();
    } else if (_codeSent) {
      _verify();
    } else {
      _request();
    }
  }

  List<Widget> _fields() {
    if (!_bySms) {
      return [
        TextField(
          controller: _invite,
          autofocus: true,
          minLines: 2,
          maxLines: 3,
          keyboardType: TextInputType.url,
          autocorrect: false,
          enableSuggestions: false,
          style: const TextStyle(fontSize: 15),
          decoration: const InputDecoration(
            hintText: 'https://…/join/…',
            helperText: 'Pasting the whole message is fine.',
            helperStyle: TextStyle(color: Palette.muted),
          ),
        ),
      ];
    }
    if (!_codeSent) {
      return [
        TextField(
          controller: _phone,
          keyboardType: TextInputType.phone,
          autofocus: true,
          style: const TextStyle(fontSize: 18),
          decoration: const InputDecoration(hintText: '+234 803 411 2098'),
        ),
      ];
    }
    return [
      TextField(
        controller: _code,
        keyboardType: TextInputType.number,
        autofocus: true,
        maxLength: 6,
        style: const TextStyle(fontSize: 24, letterSpacing: 8),
        decoration: InputDecoration(
          hintText: '······',
          counterText: '',
          helperText: _devCode != null ? 'Dev code: $_devCode' : null,
          helperStyle: const TextStyle(color: Palette.hold),
        ),
        onSubmitted: (_) => _verify(),
      ),
    ];
  }
}
