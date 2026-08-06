import 'package:flutter/material.dart';

import '../api/client.dart';
import '../store/repository.dart';
import 'theme.dart';

/// "Which event?" — the usher's assigned legs, then straight into the gate.
class AssignmentsScreen extends StatefulWidget {
  final ApiClient api;
  final Repository repo;
  final void Function(
    String legId,
    String? entranceId,
    String eventName,
    String gateName,
  )
  onOpenLeg;
  final Future<void> Function() onSignOut;

  const AssignmentsScreen({
    super.key,
    required this.api,
    required this.repo,
    required this.onOpenLeg,
    required this.onSignOut,
  });

  @override
  State<AssignmentsScreen> createState() => _AssignmentsScreenState();
}

class _AssignmentsScreenState extends State<AssignmentsScreen> {
  List<dynamic>? _assignments;
  String? _error;
  String? _openingLeg;

  /// True when the list came off the disk rather than the server.
  bool _offline = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await widget.repo.assignments();
      setState(() {
        _assignments = res.rows;
        _offline = res.fromCache;
        _error = null;
      });
    } catch (_) {
      // Name the server it tried. A build made without
      // --dart-define=API_URL falls back to the emulator's 10.0.2.2, which
      // means nothing on a real handset — the app then sits on OFFLINE
      // forever with no clue why, and the queue silently piles up.
      setState(() => _error = "Couldn't reach $apiUrl");
    }
  }

  Future<void> _open(Map<String, dynamic> a) async {
    setState(() => _openingLeg = a['leg_id'] as String);
    try {
      // Bootstrap downloads everything the gate needs to work offline.
      await widget.repo.openLeg(a['leg_id'] as String);
      if (!mounted) return;
      widget.onOpenLeg(
        a['leg_id'] as String,
        a['entrance_id'] as String?,
        a['event_name'] as String,
        'Main Gate',
      );
    } catch (e) {
      // openLeg already reopens a downloaded copy when the network is the
      // only thing missing, so reaching here means there is nothing local
      // to fall back to — or the server actively refused.
      setState(() {
        _error = e is ApiException && e.isTransport
            ? "No signal, and this gate hasn't been downloaded yet. "
                  "Get online once, then it works offline."
            : "Couldn't download the guest list.";
        _openingLeg = null;
      });
    }
  }

  /// Sign out, but never quietly: an unsynced scan is a guest who was let
  /// in and whose check-in exists nowhere else. Signing out drops the token
  /// that queue would have replayed with, so discarding it is permanent.
  Future<void> _signOut() async {
    var pending = await widget.repo.pendingCount();

    // Try to make the problem go away before asking about it. Usually the
    // phone has signal by the time anyone signs out and this leaves zero.
    if (pending > 0) {
      try {
        await widget.repo.sync();
        pending = await widget.repo.pendingCount();
      } catch (_) {
        // Still offline. The dialog below says so plainly.
      }
    }

    if (!mounted) return;

    if (pending > 0) {
      final discard = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          backgroundColor: Palette.surface,
          title: Text('$pending check-in${pending == 1 ? '' : 's'} not sent'),
          content: Text(
            "They're saved on this phone but haven't reached the server, and "
            'signing out deletes them. Get online and open the gate again to '
            'send them first.',
            style: const TextStyle(color: Palette.muted, fontSize: 14),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('Stay signed in'),
            ),
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: const Text(
                'Delete and sign out',
                style: TextStyle(color: Palette.deny),
              ),
            ),
          ],
        ),
      );
      if (discard != true) return;
    }

    await widget.onSignOut();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Which event?'),
        actions: [
          PopupMenuButton<String>(
            onSelected: (v) {
              if (v == 'signout') _signOut();
            },
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'signout', child: Text('Sign out')),
            ],
          ),
        ],
      ),
      body: _error != null
          ? Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(_error!, style: const TextStyle(color: Palette.deny)),
                  TextButton(onPressed: _load, child: const Text('Retry')),
                ],
              ),
            )
          : _assignments == null
          ? const Center(child: CircularProgressIndicator())
          : _assignments!.isEmpty
          ? const Center(
              child: Text(
                'No events assigned to you yet.',
                style: TextStyle(color: Palette.muted),
              ),
            )
          : Column(
              children: [
                if (_offline)
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 10,
                    ),
                    color: Palette.hold.withValues(alpha: .15),
                    child: const Text(
                      'Offline — showing gates already downloaded.',
                      style: TextStyle(fontSize: 12.5, color: Palette.hold),
                    ),
                  ),
                Expanded(
                  child: ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: _assignments!.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 12),
                    itemBuilder: (context, i) {
                      final a = _assignments![i] as Map<String, dynamic>;
                      final opening = _openingLeg == a['leg_id'];
                      return Material(
                        color: Palette.surface,
                        borderRadius: BorderRadius.circular(16),
                        child: InkWell(
                          borderRadius: BorderRadius.circular(16),
                          onTap: opening ? null : () => _open(a),
                          child: Container(
                            padding: const EdgeInsets.all(18),
                            decoration: BoxDecoration(
                              border: Border.all(color: Palette.line),
                              borderRadius: BorderRadius.circular(16),
                            ),
                            child: Row(
                              children: [
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        a['event_name'] as String,
                                        style: const TextStyle(
                                          fontSize: 16.5,
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        '${a['leg_name']} · ${a['guest_count']} households',
                                        style: const TextStyle(
                                          fontSize: 13,
                                          color: Palette.muted,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                                if (opening)
                                  const SizedBox(
                                    width: 18,
                                    height: 18,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                else
                                  const Icon(
                                    Icons.chevron_right,
                                    color: Palette.muted,
                                  ),
                              ],
                            ),
                          ),
                        ),
                      );
                    },
                  ),
                ),
              ],
            ),
    );
  }
}
