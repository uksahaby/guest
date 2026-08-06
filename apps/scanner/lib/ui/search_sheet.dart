import 'package:flutter/material.dart';

import '../store/repository.dart';
import 'theme.dart';

/// Name search — a primary path, not a fallback (phase-4c §8): dead phones
/// are constant. Three characters minimum, searches name and phone against
/// the local cache, so it works offline like everything else.
/// Returns the picked pass id.
Future<String?> showSearchSheet(
  BuildContext context,
  Repository repo,
  String legId,
) {
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Palette.surface,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
    ),
    builder: (context) => _SearchSheet(repo: repo, legId: legId),
  );
}

class _SearchSheet extends StatefulWidget {
  final Repository repo;
  final String legId;
  const _SearchSheet({required this.repo, required this.legId});

  @override
  State<_SearchSheet> createState() => _SearchSheetState();
}

class _SearchSheetState extends State<_SearchSheet> {
  List<InvitationEntry> _results = const [];

  Future<void> _search(String q) async {
    final rows = await widget.repo.search(widget.legId, q);
    if (mounted) setState(() => _results = rows);
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(context).viewInsets.bottom,
      ),
      child: SizedBox(
        height: MediaQuery.of(context).size.height * .72,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 18, 20, 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'SEARCH GUESTS',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 1.5,
                  color: Palette.muted,
                ),
              ),
              const SizedBox(height: 14),
              TextField(
                autofocus: true,
                onChanged: _search,
                style: const TextStyle(fontSize: 16),
                decoration: const InputDecoration(
                  hintText: 'Name or phone number',
                ),
              ),
              const SizedBox(height: 8),
              Expanded(
                child: ListView.builder(
                  itemCount: _results.length,
                  itemBuilder: (context, i) {
                    final e = _results[i];
                    final full = e.admitted >= e.row.allowance;
                    return InkWell(
                      onTap: () => Navigator.of(context).pop(e.row.passId),
                      child: Container(
                        padding: const EdgeInsets.symmetric(vertical: 15),
                        decoration: BoxDecoration(
                          border: Border(
                            bottom: BorderSide(
                              color: Colors.white.withValues(alpha: .07),
                            ),
                          ),
                        ),
                        child: Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    e.row.displayName,
                                    style: const TextStyle(
                                      fontSize: 16,
                                      fontWeight: FontWeight.w500,
                                    ),
                                  ),
                                  const SizedBox(height: 3),
                                  Text(
                                    [
                                      if (e.row.category != null)
                                        e.row.category!,
                                      'Party of ${e.row.allowance}',
                                    ].join(' · '),
                                    style: const TextStyle(
                                      fontSize: 12.5,
                                      color: Palette.muted,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            Text(
                              e.admitted == 0
                                  ? 'NOT ARRIVED'
                                  : full
                                  ? '${e.admitted} IN'
                                  : '${e.admitted} OF ${e.row.allowance}',
                              style: TextStyle(
                                fontSize: 11.5,
                                fontWeight: FontWeight.w600,
                                letterSpacing: .5,
                                color: e.admitted > 0
                                    ? Palette.admit
                                    : Palette.muted,
                              ),
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
