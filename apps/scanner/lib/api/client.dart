import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

/// Thin typed wrapper over the API. One backend serves every surface;
/// this client covers the scanner's slice of spec/openapi-v1.yaml.
///
/// Base URL: pass --dart-define=API_URL=... ; the default targets the
/// Android emulator's view of the host machine.
const apiUrl = String.fromEnvironment(
  'API_URL',
  defaultValue: 'http://10.0.2.2:3001',
);

class ApiException implements Exception {
  final int status;
  final String code;
  final String message;
  ApiException(this.status, this.code, this.message);

  /// The request never got an answer — as opposed to being refused by the
  /// server. Callers fall back to the local copy on this, and only on this.
  bool get isTransport => status == 0 || status == 408 || status >= 500;

  @override
  String toString() => 'ApiException($status $code): $message';
}

/// Nothing at a gate may wait forever. Without these, a half-open socket —
/// the phone walking out of Wi-Fi range mid-request — hangs the calling
/// screen indefinitely, and restoring signal does not recover it, because
/// nothing ever fails and nothing ever retries. Found on a real device.
const _requestTimeout = Duration(seconds: 12);

/// The queue replay carries up to 500 rows and runs in the background, so
/// it gets longer before we call it lost.
const _syncTimeout = Duration(seconds: 30);

class ApiClient {
  final String baseUrl;
  final http.Client _http;
  final Duration requestTimeout;
  final Duration syncTimeout;
  String? token;

  ApiClient({
    this.baseUrl = apiUrl,
    http.Client? httpClient,
    this.token,
    // Overridable so tests can assert the deadline without waiting for it.
    this.requestTimeout = _requestTimeout,
    this.syncTimeout = _syncTimeout,
  }) : _http = httpClient ?? http.Client();

  Map<String, String> get _headers => {
        'content-type': 'application/json',
        if (token != null) 'authorization': 'Bearer $token',
      };

  Future<dynamic> _send(
    String method,
    String path, {
    Object? body,
    Duration? timeout,
  }) async {
    final deadline = timeout ?? requestTimeout;
    final uri = Uri.parse('$baseUrl$path');
    final req = http.Request(method, uri)..headers.addAll(_headers);
    if (body != null) req.body = jsonEncode(body);

    final http.Response res;
    try {
      // The deadline covers reading the body too: a response that starts
      // and then stalls is the same problem as one that never starts.
      final streamed = await _http.send(req).timeout(deadline);
      res = await http.Response.fromStream(streamed).timeout(deadline);
    } on TimeoutException {
      throw ApiException(408, 'timeout', "The network didn't answer.");
    } on http.ClientException catch (e) {
      throw ApiException(0, 'unreachable', e.message);
    }

    final decoded = res.body.isEmpty ? null : jsonDecode(res.body);
    if (res.statusCode >= 400) {
      final map = decoded is Map<String, dynamic> ? decoded : const {};
      throw ApiException(
        res.statusCode,
        (map['code'] ?? 'error') as String,
        (map['message'] ?? 'Request failed') as String,
      );
    }
    return decoded;
  }

  // ---- auth ---------------------------------------------------------------

  Future<Map<String, dynamic>> requestOtp(String phone) async =>
      (await _send('POST', '/auth/otp/request', body: {'phone': phone}))
          as Map<String, dynamic>;

  /// Returns the Session map and remembers its access_token.
  Future<Map<String, dynamic>> verifyOtp(String phone, String code) async {
    final session = (await _send('POST', '/auth/otp/verify',
        body: {'phone': phone, 'code': code})) as Map<String, dynamic>;
    token = session['access_token'] as String;
    return session;
  }

  // ---- scanner ------------------------------------------------------------

  Future<List<dynamic>> assignments() async =>
      (await _send('GET', '/scanner/assignments')) as List<dynamic>;

  Future<Map<String, dynamic>> bootstrap(String legId) async =>
      (await _send('GET', '/scanner/legs/$legId/bootstrap'))
          as Map<String, dynamic>;

  Future<List<dynamic>> submitCheckIns(
      List<Map<String, dynamic>> items) async {
    final res = (await _send('POST', '/scanner/check-ins',
        body: {'items': items}, timeout: syncTimeout)) as Map<String, dynamic>;
    return res['results'] as List<dynamic>;
  }

  /// Creates the household a walk-in needs, replaying the ids this device
  /// minted at the gate so a retry cannot invent a second one.
  Future<Map<String, dynamic>> submitWalkIn({
    required String legId,
    required String clientUuid,
    required String displayName,
    required int count,
    String? entranceId,
    String? passId,
  }) async =>
      (await _send('POST', '/scanner/legs/$legId/walk-ins', body: {
        'client_uuid': clientUuid,
        'display_name': displayName,
        'count': count,
        'entrance_id': ?entranceId,
        'pass_id': ?passId,
      })) as Map<String, dynamic>;

  Future<void> testPing(String legId) =>
      _send('POST', '/scanner/legs/$legId/test');
}
