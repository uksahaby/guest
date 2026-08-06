import 'dart:async';

import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/checkin.dart';
import '../store/repository.dart';
import 'result_overlay.dart';
import 'sounds.dart';
import 'recent_sheet.dart';
import 'search_sheet.dart';
import 'walk_in_sheet.dart';
import 'theme.dart';

/// The gate. Camera resting state with the reticle sweep; a result takes
/// over the whole screen; green states hand back to the camera on their
/// own (phase-4c: the admit path must never gain a tap).
class ScanScreen extends StatefulWidget {
  final Repository repo;
  final String legId;
  final String? entranceId;
  final String eventName;
  final String gateName;

  const ScanScreen({
    super.key,
    required this.repo,
    required this.legId,
    this.entranceId,
    required this.eventName,
    required this.gateName,
  });

  @override
  State<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends State<ScanScreen> {
  final MobileScannerController _camera = MobileScannerController(
    formats: const [BarcodeFormat.qrCode],
  );

  ScanRecord? _current;

  /// The raw token behind the result on screen, when it came from the
  /// camera. A needs_count confirm must re-run as a SCAN (logging
  /// admitted/partial), not as a manual check-in.
  String? _sourceRaw;
  String? _lastRaw;
  DateTime _lastAt = DateTime.fromMillisecondsSinceEpoch(0);
  int _pending = 0;
  bool _syncing = false;
  Timer? _syncTimer;

  @override
  void initState() {
    super.initState();
    // Decode the cues now. Left to the first scan, the codec spins up while
    // a guest is standing there and the sound lands after the screen has
    // already changed — which reads as the sound belonging to the next
    // person in the queue.
    GateSounds.instance.warmUp().then((_) {
      if (mounted) setState(() {});
    });
    _refreshPending();
    // The queue replays whenever signal allows; a failure just waits for
    // the next tick. Check-in never stops.
    _syncTimer = Timer.periodic(const Duration(seconds: 12), (_) => _sync());
    widget.repo.api.testPing(widget.legId).catchError((_) {});
  }

  @override
  void dispose() {
    _syncTimer?.cancel();
    _camera.dispose();
    super.dispose();
  }

  Future<void> _refreshPending() async {
    final n = await widget.repo.pendingCount();
    if (mounted) setState(() => _pending = n);
  }

  Future<void> _sync() async {
    if (_syncing) return;
    _syncing = true;
    try {
      await widget.repo.sync();
    } catch (_) {
      // Offline — the strip stays up, the queue keeps growing. Fine.
    } finally {
      _syncing = false;
      await _refreshPending();
    }
  }

  Future<void> _onDetect(BarcodeCapture capture) async {
    if (_current != null) return; // a result is on screen
    final raw = capture.barcodes.firstOrNull?.rawValue;
    if (raw == null) return;

    // Debounce: the camera fires the same code many times a second.
    final now = DateTime.now();
    if (raw == _lastRaw && now.difference(_lastAt).inMilliseconds < 2000) {
      return;
    }
    _lastRaw = raw;
    _lastAt = now;

    final rec = await widget.repo.handle(
      widget.legId,
      raw: raw,
      entranceId: widget.entranceId,
    );
    if (mounted) {
      setState(() {
        _current = rec;
        _sourceRaw = raw;
      });
    }
    _refreshPending();
  }

  Future<void> _admitCount(int count) async {
    final prev = _current;
    if (prev == null || prev.decision.outcome != Outcome.needsCount) return;
    final inv = prev.decision.invitation;

    final ScanRecord rec;
    if (_sourceRaw != null) {
      rec = await widget.repo.handle(
        widget.legId,
        raw: _sourceRaw,
        requestedCount: count,
        entranceId: widget.entranceId,
      );
    } else if (inv != null) {
      rec = await widget.repo.handle(
        widget.legId,
        manualPassId: inv.passId,
        requestedCount: count,
        entranceId: widget.entranceId,
      );
    } else {
      return;
    }
    if (mounted) setState(() => _current = rec);
    _refreshPending();
  }

  void _close() {
    if (mounted) {
      setState(() {
        _current = null;
        _sourceRaw = null;
      });
    }
  }

  /// Dial whoever the organiser nominated for this event.
  ///
  /// The number rides in the offline payload, so this works at a gate with
  /// no signal — which is exactly where an usher is standing when a guest
  /// they cannot admit starts arguing.
  Future<void> _callManager() async {
    final m = await widget.repo.meta(widget.legId);
    if (!mounted) return;

    final number = m?.managerPhone;
    if (number == null || number.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'No number set for this event. The organiser adds one in Settings.',
          ),
        ),
      );
      return;
    }

    // DIAL rather than CALL: it opens the dialler with the number filled
    // in and lets the usher press the button. Placing a call outright
    // needs a permission, and a mis-tap at a gate should not ring someone.
    final uri = Uri(scheme: 'tel', path: number);
    if (!await launchUrl(uri) && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not open the dialler. Call $number.')),
      );
    }
  }

  Future<void> _toggleMute() async {
    await GateSounds.instance.setMuted(!GateSounds.instance.muted);
    if (!mounted) return;
    setState(() {});
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        duration: const Duration(seconds: 2),
        content: Text(
          GateSounds.instance.muted
              ? 'Sound off — the phone still buzzes.'
              : 'Sound on.',
        ),
      ),
    );
  }

  /// What this phone has done here, and the only way to take back an
  /// admission once the result overlay has gone.
  Future<void> _openRecent() async {
    await showRecentSheet(context, widget.repo, widget.legId);
    // An undo writes a reversal, so the queue and the counts both move.
    await _refreshPending();
  }

  /// Someone not on the list. Works with no signal: the household is
  /// created locally and the queue carries it up when the network returns,
  /// exactly like any other scan.
  Future<void> _openWalkIn() async {
    final m = await widget.repo.meta(widget.legId);
    if (!mounted) return;
    if (m != null && !m.allowWalkins) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('This event does not admit walk-ins.')),
      );
      return;
    }

    final result = await showWalkInSheet(context);
    if (result == null || !mounted) return;

    try {
      final rec = await widget.repo.addWalkIn(
        widget.legId,
        displayName: result.name,
        count: result.count,
        entranceId: widget.entranceId,
      );
      await _refreshPending();
      if (!mounted) return;
      setState(() {
        _current = rec;
        _sourceRaw = null;
      });
    } on StateError catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _openSearch() async {
    final picked = await showSearchSheet(context, widget.repo, widget.legId);
    if (picked != null) {
      final rec = await widget.repo.handle(
        widget.legId,
        manualPassId: picked,
        entranceId: widget.entranceId,
      );
      if (mounted) {
        setState(() {
          _current = rec;
          _sourceRaw = null; // came from search — stays a manual check-in
        });
      }
      _refreshPending();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Stack(
          children: [
            Column(
              children: [
                _topBar(),
                if (_pending > 0) _offlineStrip(),
                Expanded(child: _cameraView()),
                _bottomBar(),
              ],
            ),
            if (_current != null)
              Positioned.fill(
                child: ResultOverlay(
                  decision: _current!.decision,
                  onClose: _close,
                  onAdmitCount: _admitCount,
                  onUndo: _current!.clientUuid != null
                      ? () => widget.repo.undo(_current!.clientUuid!)
                      : null,
                  onAction: (a) {
                    if (a == 'Search by name') {
                      _close();
                      _openSearch();
                    } else if (a == 'Add walk-in') {
                      _close();
                      _openWalkIn();
                    } else if (a == 'Call manager') {
                      _close();
                      _callManager();
                    } else {
                      _close();
                    }
                  },
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _topBar() => Padding(
    padding: const EdgeInsets.fromLTRB(18, 16, 18, 14),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                widget.eventName,
                style: const TextStyle(
                  fontSize: 14.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                widget.gateName,
                style: const TextStyle(fontSize: 12, color: Palette.muted),
              ),
            ],
          ),
        ),
        // A ceremony is the case this exists for: a chime during vows
        // is worse than an usher glancing at the screen. Icon only, and
        // deliberately not next to anything destructive.
        IconButton(
          onPressed: _toggleMute,
          visualDensity: VisualDensity.compact,
          tooltip: GateSounds.instance.muted ? 'Sound off' : 'Sound on',
          icon: Icon(
            GateSounds.instance.muted
                ? Icons.volume_off_outlined
                : Icons.volume_up_outlined,
            size: 19,
            color: GateSounds.instance.muted ? Palette.hold : Palette.muted,
          ),
        ),
        // Next to the sync badge rather than in the bottom bar: it is
        // reached after something has gone wrong, not during a queue.
        TextButton(
          onPressed: _openRecent,
          style: TextButton.styleFrom(
            minimumSize: const Size(0, 32),
            padding: const EdgeInsets.symmetric(horizontal: 10),
            foregroundColor: Palette.muted,
          ),
          child: const Text('Recent', style: TextStyle(fontSize: 12.5)),
        ),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
          decoration: BoxDecoration(
            border: Border.all(
              color: _pending > 0 ? const Color(0xFF5A4718) : Palette.line,
            ),
            color: _pending > 0 ? Palette.holdWash : null,
            borderRadius: BorderRadius.circular(6),
          ),
          child: Text(
            _pending > 0 ? 'OFFLINE' : 'SYNCED',
            style: TextStyle(
              fontSize: 10.5,
              fontWeight: FontWeight.w600,
              letterSpacing: .6,
              color: _pending > 0 ? Palette.hold : Palette.muted,
            ),
          ),
        ),
      ],
    ),
  );

  Widget _offlineStrip() => Container(
    width: double.infinity,
    padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 9),
    decoration: const BoxDecoration(
      color: Palette.holdWash,
      border: Border.symmetric(
        horizontal: BorderSide(color: Color(0xFF5A4718)),
      ),
    ),
    child: Text(
      '$_pending ${_pending == 1 ? 'scan' : 'scans'} waiting to sync',
      style: const TextStyle(
        fontSize: 12,
        fontWeight: FontWeight.w500,
        color: Palette.hold,
      ),
    ),
  );

  Widget _cameraView() => Stack(
    alignment: Alignment.center,
    children: [
      MobileScanner(controller: _camera, onDetect: _onDetect),
      IgnorePointer(
        child: SizedBox(
          width: 198,
          height: 198,
          child: CustomPaint(painter: _ReticlePainter()),
        ),
      ),
      const Positioned(
        bottom: 24,
        child: Text(
          "Point at the guest's pass",
          style: TextStyle(fontSize: 13, color: Palette.muted),
        ),
      ),
    ],
  );

  Widget _bottomBar() => Container(
    padding: const EdgeInsets.fromLTRB(18, 14, 18, 22),
    decoration: const BoxDecoration(
      border: Border(top: BorderSide(color: Palette.line)),
    ),
    child: Column(
      children: [
        Row(
          children: [
            Expanded(child: _barButton('Search by name', _openSearch)),
            const SizedBox(width: 10),
            Expanded(child: _barButton('Sync now', _sync)),
          ],
        ),
        const SizedBox(height: 10),
        // Full width: at a Nigerian gate this is reached for constantly,
        // and it is the button an usher hits one-handed in the dark.
        SizedBox(
          width: double.infinity,
          child: _barButton('Add walk-in', _openWalkIn),
        ),
      ],
    ),
  );

  Widget _barButton(String label, VoidCallback onTap) => Material(
    color: Palette.surface,
    borderRadius: BorderRadius.circular(12),
    child: InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: onTap,
      child: Container(
        alignment: Alignment.center,
        padding: const EdgeInsets.symmetric(vertical: 14),
        decoration: BoxDecoration(
          border: Border.all(color: Palette.line),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Text(
          label,
          style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500),
        ),
      ),
    ),
  );
}

/// The four corner brackets of the scan reticle.
class _ReticlePainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()
      ..color = Palette.admit
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.5
      ..strokeCap = StrokeCap.round;
    const len = 38.0, r = 12.0;
    final w = size.width, h = size.height;

    canvas.drawPath(
      Path()
        ..moveTo(0, len)
        ..lineTo(0, r)
        ..quadraticBezierTo(0, 0, r, 0)
        ..lineTo(len, 0),
      p,
    );
    canvas.drawPath(
      Path()
        ..moveTo(w - len, 0)
        ..lineTo(w - r, 0)
        ..quadraticBezierTo(w, 0, w, r)
        ..lineTo(w, len),
      p,
    );
    canvas.drawPath(
      Path()
        ..moveTo(0, h - len)
        ..lineTo(0, h - r)
        ..quadraticBezierTo(0, h, r, h)
        ..lineTo(len, h),
      p,
    );
    canvas.drawPath(
      Path()
        ..moveTo(w - len, h)
        ..lineTo(w - r, h)
        ..quadraticBezierTo(w, h, w, h - r)
        ..lineTo(w, h - len),
      p,
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
