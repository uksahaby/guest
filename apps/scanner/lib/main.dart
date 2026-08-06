import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'api/client.dart';
import 'core/uuid.dart';
import 'store/db.dart';
import 'store/repository.dart';
import 'ui/assignments_screen.dart';
import 'ui/login_screen.dart';
import 'ui/scan_screen.dart';
import 'ui/theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const ScannerApp());
}

class ScannerApp extends StatefulWidget {
  const ScannerApp({super.key});

  @override
  State<ScannerApp> createState() => _ScannerAppState();
}

class _ScannerAppState extends State<ScannerApp> {
  final _storage = const FlutterSecureStorage();
  late final ApiClient _api = ApiClient();
  late final ScannerDb _db = ScannerDb();
  Repository? _repo;
  bool _ready = false;
  bool _signedIn = false;

  @override
  void initState() {
    super.initState();
    _restore();
  }

  Future<void> _restore() async {
    final jwt = await _storage.read(key: 'jwt');
    var deviceId = await _storage.read(key: 'device_id');
    if (deviceId == null) {
      deviceId = randomUuid();
      await _storage.write(key: 'device_id', value: deviceId);
    }
    _api.token = jwt;
    _repo = Repository(db: _db, api: _api, deviceId: deviceId);
    setState(() {
      _signedIn = jwt != null;
      _ready = true;
    });
  }

  /// Drops the session and everything downloaded under it.
  ///
  /// The device id deliberately survives. It identifies the handset, not
  /// the person, and the server uses it to recognise a replayed queue —
  /// rotating it on every sign-out would turn one phone into many and
  /// break that idempotency for no gain.
  Future<void> _signOut() async {
    await _repo?.wipe();
    await _storage.delete(key: 'jwt');
    _api.token = null;
    if (mounted) setState(() => _signedIn = false);
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Scanner',
      theme: scannerTheme(),
      debugShowCheckedModeBanner: false,
      home: !_ready
          ? const Scaffold(body: Center(child: CircularProgressIndicator()))
          : !_signedIn
          ? LoginScreen(
              api: _api,
              onSignedIn: () => setState(() => _signedIn = true),
            )
          : _Home(api: _api, repo: _repo!, onSignOut: _signOut),
    );
  }
}

class _Home extends StatelessWidget {
  final ApiClient api;
  final Repository repo;
  final Future<void> Function() onSignOut;
  const _Home({required this.api, required this.repo, required this.onSignOut});

  @override
  Widget build(BuildContext context) {
    return AssignmentsScreen(
      api: api,
      repo: repo,
      onSignOut: onSignOut,
      onOpenLeg: (legId, entranceId, eventName, gateName) {
        Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => ScanScreen(
              repo: repo,
              legId: legId,
              entranceId: entranceId,
              eventName: eventName,
              gateName: gateName,
            ),
          ),
        );
      },
    );
  }
}
