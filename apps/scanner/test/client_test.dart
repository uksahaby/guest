// Request deadlines.
//
// Found on a real phone: with no timeout, a half-open socket — the handset
// walking out of range mid-request — hung the calling screen forever, and
// restoring signal did not recover it, because nothing ever failed and so
// nothing ever retried. The card that opens a gate is disabled while it is
// opening, so the only way out was force-quitting the app.
import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:scanner/api/client.dart';

/// A client whose responses never arrive.
class _HangingClient extends http.BaseClient {
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) =>
      Completer<http.StreamedResponse>().future; // never completes
}

/// A client whose body starts and then stalls — the case a connect-only
/// timeout would miss.
class _StallingBodyClient extends http.BaseClient {
  @override
  Future<http.StreamedResponse> send(
    http.BaseRequest request,
  ) async => http.StreamedResponse(
    StreamController<List<int>>().stream, // opens, never emits, never closes
    200,
  );
}

class _RefusingClient extends http.BaseClient {
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) =>
      throw http.ClientException('Connection refused', request.url);
}

class _ErroringClient extends http.BaseClient {
  final int status;
  final String body;
  _ErroringClient(this.status, this.body);

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async =>
      http.StreamedResponse(Stream.value(body.codeUnits), status);
}

void main() {
  ApiClient clientWith(http.Client inner) => ApiClient(
    baseUrl: 'http://test',
    httpClient: inner,
    requestTimeout: const Duration(milliseconds: 50),
    syncTimeout: const Duration(milliseconds: 50),
  );

  test('a request that never answers fails instead of hanging', () async {
    final api = clientWith(_HangingClient());
    await expectLater(
      () => api.bootstrap('leg-1'),
      throwsA(isA<ApiException>().having((e) => e.status, 'status', 408)),
    );
  });

  test('a response that stalls mid-body also fails', () async {
    // The deadline covers reading the body, not just getting the headers.
    final api = clientWith(_StallingBodyClient());
    await expectLater(
      () => api.bootstrap('leg-1'),
      throwsA(isA<ApiException>().having((e) => e.status, 'status', 408)),
    );
  });

  test('the deadline is actually enforced, not merely declared', () async {
    final api = clientWith(_HangingClient());
    final started = DateTime.now();
    await api.bootstrap('leg-1').catchError((Object _) => <String, dynamic>{});
    final elapsed = DateTime.now().difference(started);
    expect(elapsed, lessThan(const Duration(seconds: 2)));
  });

  test('a refused connection is reported as unreachable', () async {
    final api = clientWith(_RefusingClient());
    await expectLater(
      () => api.assignments(),
      throwsA(isA<ApiException>().having((e) => e.status, 'status', 0)),
    );
  });

  test('transport failures are distinguishable from refusals', () {
    // openLeg keys its cache fallback on exactly this split: never fall back
    // for a 403, or an usher removed from a gate could keep admitting.
    expect(ApiException(408, 'timeout', '').isTransport, isTrue);
    expect(ApiException(0, 'unreachable', '').isTransport, isTrue);
    expect(ApiException(503, 'unavailable', '').isTransport, isTrue);
    expect(ApiException(403, 'forbidden', '').isTransport, isFalse);
    expect(ApiException(401, 'unauthenticated', '').isTransport, isFalse);
    expect(ApiException(404, 'not_found', '').isTransport, isFalse);
  });

  test('a server error keeps its status and message', () async {
    final api = clientWith(
      _ErroringClient(403, '{"code":"forbidden","message":"Not your gate."}'),
    );
    await expectLater(
      () => api.bootstrap('leg-1'),
      throwsA(
        isA<ApiException>()
            .having((e) => e.status, 'status', 403)
            .having((e) => e.message, 'message', 'Not your gate.'),
      ),
    );
  });

  test('the queue replay gets its own, longer deadline', () {
    final api = ApiClient(baseUrl: 'http://test');
    expect(api.syncTimeout, greaterThan(api.requestTimeout));
  });
}
