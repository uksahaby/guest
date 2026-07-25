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
  @override
  String toString() => 'ApiException($status $code): $message';
}

class ApiClient {
  final String baseUrl;
  final http.Client _http;
  String? token;

  ApiClient({this.baseUrl = apiUrl, http.Client? httpClient, this.token})
      : _http = httpClient ?? http.Client();

  Map<String, String> get _headers => {
        'content-type': 'application/json',
        if (token != null) 'authorization': 'Bearer $token',
      };

  Future<dynamic> _send(String method, String path, {Object? body}) async {
    final uri = Uri.parse('$baseUrl$path');
    final req = http.Request(method, uri)..headers.addAll(_headers);
    if (body != null) req.body = jsonEncode(body);
    final res = await http.Response.fromStream(await _http.send(req));
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
        body: {'items': items})) as Map<String, dynamic>;
    return res['results'] as List<dynamic>;
  }

  Future<void> testPing(String legId) =>
      _send('POST', '/scanner/legs/$legId/test');
}
