import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../api/client.dart';
import 'theme.dart';

/// OTP sign-in, per mockups/auth-usher-admin.html "Sign in to check guests
/// in". Phone → six-digit code → session. Ushers never have a password.
class LoginScreen extends StatefulWidget {
  final ApiClient api;
  final VoidCallback onSignedIn;
  const LoginScreen({super.key, required this.api, required this.onSignedIn});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _phone = TextEditingController(text: '+234');
  final _code = TextEditingController();
  final _storage = const FlutterSecureStorage();

  bool _codeSent = false;
  bool _busy = false;
  String? _error;
  String? _devCode;

  Future<void> _request() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final res = await widget.api.requestOtp(_phone.text.trim());
      setState(() {
        _codeSent = true;
        // Dev servers return the code so the flow is testable end to end.
        _devCode = res['dev_code'] as String?;
      });
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = "Couldn't reach the server.");
    } finally {
      setState(() => _busy = false);
    }
  }

  Future<void> _verify() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.api.verifyOtp(_phone.text.trim(), _code.text.trim());
      await _storage.write(key: 'jwt', value: widget.api.token);
      widget.onSignedIn();
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = "Couldn't reach the server.");
    } finally {
      setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(26),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Spacer(),
              const Text('Sign in to check guests in',
                  style: TextStyle(
                      fontSize: 26,
                      fontWeight: FontWeight.w600,
                      letterSpacing: -.5)),
              const SizedBox(height: 8),
              Text(
                _codeSent
                    ? 'Enter the six-digit code we sent to ${_phone.text}.'
                    : "Your phone number is your login. We'll text you a code.",
                style: const TextStyle(fontSize: 14.5, color: Palette.muted),
              ),
              const SizedBox(height: 28),
              if (!_codeSent)
                TextField(
                  controller: _phone,
                  keyboardType: TextInputType.phone,
                  autofocus: true,
                  style: const TextStyle(fontSize: 18),
                  decoration:
                      const InputDecoration(hintText: '+234 803 411 2098'),
                )
              else
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
                  onPressed: _busy ? null : (_codeSent ? _verify : _request),
                  child: Text(_codeSent ? 'Sign in' : 'Send code',
                      style: const TextStyle(
                          fontSize: 15, fontWeight: FontWeight.w600)),
                ),
              ),
              if (_codeSent)
                TextButton(
                  onPressed: _busy ? null : _request,
                  child: const Text('Resend code',
                      style: TextStyle(color: Palette.muted)),
                ),
              const Spacer(flex: 2),
            ],
          ),
        ),
      ),
    );
  }
}
