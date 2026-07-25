import 'package:flutter/material.dart';

import '../api/client.dart';
import '../store/repository.dart';
import 'theme.dart';

/// "Which event?" — the usher's assigned legs, then straight into the gate.
class AssignmentsScreen extends StatefulWidget {
  final ApiClient api;
  final Repository repo;
  final void Function(String legId, String? entranceId, String eventName,
      String gateName) onOpenLeg;

  const AssignmentsScreen({
    super.key,
    required this.api,
    required this.repo,
    required this.onOpenLeg,
  });

  @override
  State<AssignmentsScreen> createState() => _AssignmentsScreenState();
}

class _AssignmentsScreenState extends State<AssignmentsScreen> {
  List<dynamic>? _assignments;
  String? _error;
  String? _openingLeg;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final rows = await widget.api.assignments();
      setState(() => _assignments = rows);
    } catch (_) {
      setState(() => _error = "Couldn't load your events.");
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
    } catch (_) {
      setState(() {
        _error = "Couldn't download the guest list.";
        _openingLeg = null;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Which event?')),
      body: _error != null
          ? Center(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
              Text(_error!, style: const TextStyle(color: Palette.deny)),
              TextButton(onPressed: _load, child: const Text('Retry')),
            ]))
          : _assignments == null
              ? const Center(child: CircularProgressIndicator())
              : _assignments!.isEmpty
                  ? const Center(
                      child: Text('No events assigned to you yet.',
                          style: TextStyle(color: Palette.muted)))
                  : ListView.separated(
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
                              child: Row(children: [
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(a['event_name'] as String,
                                          style: const TextStyle(
                                              fontSize: 16.5,
                                              fontWeight: FontWeight.w600)),
                                      const SizedBox(height: 4),
                                      Text(
                                        '${a['leg_name']} · ${a['guest_count']} households',
                                        style: const TextStyle(
                                            fontSize: 13, color: Palette.muted),
                                      ),
                                    ],
                                  ),
                                ),
                                if (opening)
                                  const SizedBox(
                                      width: 18,
                                      height: 18,
                                      child: CircularProgressIndicator(
                                          strokeWidth: 2))
                                else
                                  const Icon(Icons.chevron_right,
                                      color: Palette.muted),
                              ]),
                            ),
                          ),
                        );
                      },
                    ),
    );
  }
}
