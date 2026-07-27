import 'package:flutter/material.dart';

import 'theme.dart';

/// Name and headcount for someone who is not on the list.
///
/// Deliberately two fields and nothing else. This is filled in while a
/// family stands waiting, often one-handed, so it asks for the least that
/// still leaves the organiser something useful in the report: a name they
/// can recognise, and how many came through.
class WalkIn {
  final String name;
  final int count;
  const WalkIn(this.name, this.count);
}

Future<WalkIn?> showWalkInSheet(BuildContext context) => showModalBottomSheet<WalkIn>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Palette.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
      ),
      builder: (_) => const _WalkInSheet(),
    );

class _WalkInSheet extends StatefulWidget {
  const _WalkInSheet();

  @override
  State<_WalkInSheet> createState() => _WalkInSheetState();
}

class _WalkInSheetState extends State<_WalkInSheet> {
  final _name = TextEditingController();
  int _count = 1;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  void _submit() {
    final name = _name.text.trim();
    if (name.isEmpty) return;
    Navigator.of(context).pop(WalkIn(name, _count));
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      // Keeps the fields above the keyboard.
      padding: EdgeInsets.only(
        left: 18,
        right: 18,
        top: 18,
        bottom: MediaQuery.of(context).viewInsets.bottom + 18,
      ),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        const Align(
          alignment: Alignment.centerLeft,
          child: Text('WALK-IN',
              style: TextStyle(
                  fontSize: 12,
                  letterSpacing: 1.2,
                  fontWeight: FontWeight.w600,
                  color: Palette.muted)),
        ),
        const SizedBox(height: 14),
        TextField(
          controller: _name,
          autofocus: true,
          textCapitalization: TextCapitalization.words,
          maxLength: 200,
          onSubmitted: (_) => _submit(),
          decoration: const InputDecoration(
            hintText: 'Name, as you would read it off a card',
            counterText: '',
          ),
          style: const TextStyle(fontSize: 16),
        ),
        const SizedBox(height: 18),
        const Align(
          alignment: Alignment.centerLeft,
          child: Text('How many?',
              style: TextStyle(fontSize: 14, color: Palette.muted)),
        ),
        const SizedBox(height: 10),
        Wrap(
          spacing: 10,
          runSpacing: 10,
          children: [
            for (final n in const [1, 2, 3, 4, 5, 6])
              _CountChip(
                n: n,
                selected: _count == n,
                onTap: () => setState(() => _count = n),
              ),
          ],
        ),
        const SizedBox(height: 20),
        SizedBox(
          width: double.infinity,
          child: FilledButton(
            onPressed: _submit,
            style: FilledButton.styleFrom(
              backgroundColor: Palette.admit,
              foregroundColor: Palette.ground,
              padding: const EdgeInsets.symmetric(vertical: 16),
            ),
            child: Text('Admit $_count'),
          ),
        ),
      ]),
    );
  }
}

class _CountChip extends StatelessWidget {
  final int n;
  final bool selected;
  final VoidCallback onTap;
  const _CountChip({required this.n, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) => Material(
        color: selected ? Palette.admit : Palette.ground,
        borderRadius: BorderRadius.circular(14),
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: onTap,
          child: Container(
            width: 68,
            alignment: Alignment.center,
            padding: const EdgeInsets.symmetric(vertical: 16),
            decoration: BoxDecoration(
              border: Border.all(color: selected ? Palette.admit : Palette.line),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Text('$n',
                style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w600,
                    color: selected ? Palette.ground : Palette.text)),
          ),
        ),
      );
}
