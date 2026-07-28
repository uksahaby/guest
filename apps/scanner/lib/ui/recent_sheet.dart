import 'package:flutter/material.dart';

import '../store/repository.dart';
import 'theme.dart';

/// What this phone has done at this gate, with a way to take it back.
///
/// The result overlay offers Undo for a second and a half and then returns
/// to the camera, which is right for the common case and useless for the
/// one that matters: an usher realises thirty seconds later that they
/// admitted four when three came. Nothing in the system could fix that —
/// the log is append-only and the dashboard has no editor.
Future<void> showRecentSheet(
  BuildContext context,
  Repository repo,
  String legId,
) =>
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Palette.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
      ),
      builder: (_) => _RecentSheet(repo: repo, legId: legId),
    );

class _RecentSheet extends StatefulWidget {
  final Repository repo;
  final String legId;
  const _RecentSheet({required this.repo, required this.legId});

  @override
  State<_RecentSheet> createState() => _RecentSheetState();
}

class _RecentSheetState extends State<_RecentSheet> {
  List<RecentEntry>? _rows;
  String? _busy;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final rows = await widget.repo.recent(widget.legId);
    if (mounted) setState(() => _rows = rows);
  }

  Future<void> _undo(RecentEntry e) async {
    setState(() => _busy = e.clientUuid);
    await widget.repo.undo(e.clientUuid);
    await _load();
    if (mounted) setState(() => _busy = null);
  }

  @override
  Widget build(BuildContext context) {
    final rows = _rows;
    return SizedBox(
      height: MediaQuery.of(context).size.height * 0.75,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(18, 18, 18, 8),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('RECENT',
              style: TextStyle(
                  fontSize: 12,
                  letterSpacing: 1.2,
                  fontWeight: FontWeight.w600,
                  color: Palette.muted)),
          const SizedBox(height: 4),
          const Text('From this phone, at this gate.',
              style: TextStyle(fontSize: 12.5, color: Palette.muted)),
          const SizedBox(height: 12),
          Expanded(
            child: rows == null
                ? const Center(child: CircularProgressIndicator())
                : rows.isEmpty
                    ? const Center(
                        child: Text('Nothing yet.',
                            style: TextStyle(color: Palette.muted)))
                    : ListView.separated(
                        itemCount: rows.length,
                        separatorBuilder: (_, _) =>
                            const Divider(color: Palette.line, height: 1),
                        itemBuilder: (_, i) => _Row(
                          entry: rows[i],
                          busy: _busy == rows[i].clientUuid,
                          onUndo: () => _undo(rows[i]),
                        ),
                      ),
          ),
        ]),
      ),
    );
  }
}

class _Row extends StatelessWidget {
  final RecentEntry entry;
  final bool busy;
  final VoidCallback onUndo;
  const _Row({required this.entry, required this.busy, required this.onUndo});

  String get _when {
    final t = entry.scannedAt;
    return '${t.hour.toString().padLeft(2, '0')}:'
        '${t.minute.toString().padLeft(2, '0')}';
  }

  /// What happened, in the words an usher would use.
  String get _what {
    if (entry.reversed) return 'Undone';
    if (entry.admittedCount > 0) {
      return entry.isWalkIn
          ? 'Walked in · ${entry.admittedCount}'
          : 'Admitted ${entry.admittedCount}';
    }
    return 'Refused';
  }

  Color get _tone {
    if (entry.reversed) return Palette.muted;
    if (entry.admittedCount > 0) return Palette.admit;
    return Palette.deny;
  }

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Row(children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  entry.displayName,
                  style: TextStyle(
                    fontSize: 15.5,
                    fontWeight: FontWeight.w500,
                    decoration:
                        entry.reversed ? TextDecoration.lineThrough : null,
                    color: entry.reversed ? Palette.muted : Palette.text,
                  ),
                ),
                const SizedBox(height: 3),
                Row(children: [
                  Text('$_when · ',
                      style: const TextStyle(
                          fontSize: 12.5, color: Palette.muted)),
                  Text(_what,
                      style: TextStyle(fontSize: 12.5, color: _tone)),
                  if (!entry.synced)
                    const Text(' · waiting to sync',
                        style:
                            TextStyle(fontSize: 12.5, color: Palette.hold)),
                  if (entry.contested)
                    const Text(' · flagged',
                        style:
                            TextStyle(fontSize: 12.5, color: Palette.hold)),
                ]),
              ],
            ),
          ),
          if (busy)
            const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2))
          else if (entry.canUndo)
            TextButton(
              onPressed: onUndo,
              child: const Text('Undo'),
            ),
        ]),
      );
}
