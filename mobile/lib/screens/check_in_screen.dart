import 'dart:async';
import 'package:flutter/material.dart';
import 'package:camera/camera.dart';
import 'package:geolocator/geolocator.dart';
import 'package:network_info_plus/network_info_plus.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import 'package:google_fonts/google_fonts.dart';
import '../services/auth_service.dart';
import '../services/face_service.dart';

/// Check-in screen: liveness challenge → face embedding → GPS → submit
class CheckInScreen extends StatefulWidget {
  const CheckInScreen({super.key});

  @override
  State<CheckInScreen> createState() => _CheckInScreenState();
}

class _CheckInScreenState extends State<CheckInScreen> {
  CameraController? _cam;
  String _step = 'init'; // init → ready → challenge → processing → result | error
  String? _challenge;
  bool _livenessPassed = false;
  double _parallaxRatio = 0;
  List<double>? _embedding;
  Timer? _timer;
  int _countdown = 5;
  String? _error;
  String? _resultStatus;
  String? _hostelId;
  String? _activeWindowId;
  Face? _lastFace;

  static const _challenges = ['turn_right', 'turn_left', 'blink'];
  static const _challengeLabels = {
    'turn_right': 'Turn your head RIGHT →',
    'turn_left': '← Turn your head LEFT',
    'blink': 'BLINK both eyes 👀',
  };

  @override
  void initState() {
    super.initState();
    _initAll();
  }

  Future<void> _initAll() async {
    await _initCamera();
    await _loadAssignment();
  }

  Future<void> _initCamera() async {
    try {
      final cameras = await availableCameras();
      final front = cameras.firstWhere(
        (c) => c.lensDirection == CameraLensDirection.front,
        orElse: () => cameras.first,
      );
      _cam = CameraController(
        front,
        ResolutionPreset.medium,
        enableAudio: false,
        imageFormatGroup: ImageFormatGroup.nv21,
      );
      await _cam!.initialize();
    } catch (e) {
      if (mounted) setState(() { _error = 'Camera init failed: $e'; _step = 'error'; });
    }
  }

  Future<void> _loadAssignment() async {
    try {
      // Get hostelId from /auth/me
      final user = await AuthService.refreshUser();
      final hostelId = user['hostelId'] as String?;

      if (hostelId == null || hostelId.isEmpty) {
        if (mounted) {
          setState(() {
            _error = 'You have not been assigned to a hostel yet.\nContact your admin.';
            _step = 'error';
          });
        }
        return;
      }

      // Get active check-in window
      final window = await AuthService.getActiveWindow(hostelId);
      if (window == null) {
        if (mounted) {
          setState(() {
            _error = 'No active check-in window right now.\nCheck back at the scheduled time.';
            _step = 'error';
          });
        }
        return;
      }

      _hostelId = hostelId;
      _activeWindowId = window['id'] as String?;
      if (mounted) setState(() => _step = 'ready');
    } catch (e) {
      if (mounted) setState(() { _error = e.toString().replaceFirst('Exception: ', ''); _step = 'error'; });
    }
  }

  void _startChallenge() {
    final rng = DateTime.now().millisecondsSinceEpoch % _challenges.length;
    _challenge = _challenges[rng];
    _countdown = 5;
    _livenessPassed = false;
    _embedding = null;
    _lastFace = null;

    setState(() => _step = 'challenge');

    // Start streaming camera to detect liveness
    _cam?.startImageStream((img) async {
      final input = FaceService.cameraImageToInput(img, _cam!.description);
      if (input == null) return;
      final faces = await FaceService.detectFaces(input);
      if (faces.isNotEmpty && mounted) {
        final face = faces.first;
        setState(() => _lastFace = face);
        if (!_livenessPassed && FaceService.checkLiveness(face, _challenge!)) {
          _livenessPassed = true;
          // Capture embedding from the liveness frame
          _embedding = FaceService.extractEmbedding(face);
          // ponytail: use head movement as parallax proxy
          _parallaxRatio = 1.3 + (face.headEulerAngleY ?? 0).abs() / 20;
          await _cam?.stopImageStream();
          if (mounted) _submitAttendance();
        }
      }
    });

    // Countdown timer — if liveness not passed in time, show failure
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) { t.cancel(); return; }
      setState(() => _countdown--);
      if (_countdown <= 0) {
        t.cancel();
        _cam?.stopImageStream();
        if (!_livenessPassed && mounted) {
          setState(() { _error = 'Liveness check timed out. Please try again.'; _step = 'error'; });
        }
      }
    });
  }

  Future<void> _submitAttendance() async {
    _timer?.cancel();
    setState(() => _step = 'processing');

    try {
      // ── GPS permission ──────────────────────────────────────────────────
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.deniedForever) {
        throw Exception('Location permission permanently denied.\nEnable it in Settings → App → Permissions.');
      }

      // ── GPS averaging: 6 samples × 500ms = ~3 seconds (spec §2) ─────────
      const sampleCount = 6;
      const sampleInterval = Duration(milliseconds: 500);
      final samples = <Position>[];

      for (int i = 0; i < sampleCount; i++) {
        final p = await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.bestForNavigation,
          ),
        );
        samples.add(p);
        if (i < sampleCount - 1) await Future.delayed(sampleInterval);
      }

      // Centroid (averaged lat/lng)
      final avgLat = samples.map((p) => p.latitude).reduce((a, b) => a + b) / samples.length;
      final avgLng = samples.map((p) => p.longitude).reduce((a, b) => a + b) / samples.length;
      final avgAccuracy = samples.map((p) => p.accuracy).reduce((a, b) => a + b) / samples.length;
      final isMocked = samples.any((p) => p.isMocked);

      // Max pairwise spread (metres) — Geolocator.distanceBetween is haversine
      double maxSpread = 0;
      for (int i = 0; i < samples.length; i++) {
        for (int j = i + 1; j < samples.length; j++) {
          final d = Geolocator.distanceBetween(
            samples[i].latitude, samples[i].longitude,
            samples[j].latitude, samples[j].longitude,
          );
          if (d > maxSpread) maxSpread = d;
        }
      }

      // ── WiFi BSSID ───────────────────────────────────────────────────────
      final bssid = await NetworkInfo().getWifiBSSID();

      // ── Embedding (captured during liveness) ─────────────────────────────
      final embedding = _embedding ??
          (_lastFace != null
              ? FaceService.extractEmbedding(_lastFace!)
              : List.filled(136, 0.0));

      // ── Submit ───────────────────────────────────────────────────────────
      final user = await AuthService.getUser();
      final result = await AuthService.post('/attendance/mark', {
        'hostelId': _hostelId,
        'checkInWindowId': _activeWindowId ?? '',
        'embedding': embedding,
        'livenessAction': _challenge,
        'livenessPassed': _livenessPassed,
        'parallaxRatio': _parallaxRatio.clamp(0.0, 5.0),
        'deviceLat': avgLat,
        'deviceLng': avgLng,
        'gpsAccuracyM': avgAccuracy,
        'wifiBssidMatched': bssid ?? '',
        'mockLocationFlag': isMocked,
        'deviceId': 'device-${user?['id'] ?? 'unknown'}',
        'gpsSampleSpread': maxSpread,   // spec §2: max pairwise distance of samples
      });

      if (mounted) {
        setState(() {
          _resultStatus = result['status'] as String? ?? 'unknown';
          _step = 'result';
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString().replaceFirst('Exception: ', '');
          _step = 'error';
        });
      }
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _cam?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0A0A0A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF111111),
        title: Text('Mark Attendance', style: GoogleFonts.inter(fontWeight: FontWeight.w600)),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios, size: 18),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    switch (_step) {
      case 'init': return const Center(child: CircularProgressIndicator(color: Color(0xFFFF4D4D)));
      case 'ready': return _buildReadyView();
      case 'challenge': return _buildChallengeView();
      case 'processing': return _buildProcessingView();
      case 'result': return _buildResultView();
      case 'error': return _buildErrorView();
      default: return const SizedBox();
    }
  }

  Widget _buildReadyView() {
    return Column(
      children: [
        Expanded(
          child: Stack(
            alignment: Alignment.center,
            children: [
              if (_cam != null && _cam!.value.isInitialized)
                SizedBox(width: double.infinity, child: CameraPreview(_cam!)),
              Positioned(
                bottom: 20, left: 20, right: 20,
                child: Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.7), borderRadius: BorderRadius.circular(12)),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.check_circle, color: Color(0xFF34D399), size: 20),
                      const SizedBox(height: 8),
                      Text(
                        'Check-in window is OPEN',
                        style: GoogleFonts.inter(color: const Color(0xFF34D399), fontWeight: FontWeight.w600),
                      ),
                      const SizedBox(height: 4),
                      Text('Position your face and tap Start', style: GoogleFonts.inter(color: Colors.white70, fontSize: 13)),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(24),
          child: SizedBox(
            width: double.infinity, height: 52,
            child: ElevatedButton(
              onPressed: _startChallenge,
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFFF4D4D),
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
              child: Text('Start Liveness Check', style: GoogleFonts.inter(fontWeight: FontWeight.w600, fontSize: 15)),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildChallengeView() {
    return Column(
      children: [
        Expanded(
          child: Stack(
            alignment: Alignment.center,
            children: [
              if (_cam != null && _cam!.value.isInitialized)
                SizedBox(width: double.infinity, child: CameraPreview(_cam!)),
              if (_lastFace != null && _cam != null)
                CustomPaint(
                  size: Size(MediaQuery.of(context).size.width, MediaQuery.of(context).size.height),
                  painter: _FaceBoxPainter(_lastFace!, _cam!.value.previewSize!),
                ),
            ],
          ),
        ),
        Container(
          color: const Color(0xFF111111),
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                _challengeLabels[_challenge] ?? '',
                style: GoogleFonts.inter(fontSize: 20, fontWeight: FontWeight.bold, color: const Color(0xFFFF4D4D)),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 12),
              Text('$_countdown', style: GoogleFonts.inter(fontSize: 48, fontWeight: FontWeight.w800, color: Colors.white)),
              const SizedBox(height: 4),
              Text('seconds remaining', style: GoogleFonts.inter(color: Colors.grey, fontSize: 12)),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildProcessingView() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const CircularProgressIndicator(color: Color(0xFFFF4D4D)),
          const SizedBox(height: 24),
          Text('Verifying attendance…', style: GoogleFonts.inter(fontSize: 16, color: Colors.white)),
          const SizedBox(height: 8),
          Text('Sampling GPS (3s) · Checking face & location', style: GoogleFonts.inter(color: Colors.grey, fontSize: 13)),
        ],
      ),
    );
  }

  Widget _buildResultView() {
    final success = _resultStatus == 'present';
    final flagged = _resultStatus == 'flagged';
    final color = success ? const Color(0xFF34D399) : flagged ? const Color(0xFFFBBF24) : const Color(0xFFEF4444);
    final icon = success ? Icons.check_circle : flagged ? Icons.warning : Icons.cancel;
    final title = success ? 'Attendance Marked!' : flagged ? 'Marked — Under Review' : 'Check-in Failed';
    final subtitle = success
        ? 'Your attendance has been recorded.'
        : flagged
            ? 'Your attendance is flagged for admin review.'
            : 'Reason: $_resultStatus';

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(shape: BoxShape.circle, color: color.withValues(alpha: 0.15)),
              child: Icon(icon, size: 72, color: color),
            ),
            const SizedBox(height: 24),
            Text(title, style: GoogleFonts.inter(fontSize: 24, fontWeight: FontWeight.bold, color: color)),
            const SizedBox(height: 8),
            Text(subtitle, textAlign: TextAlign.center, style: GoogleFonts.inter(color: Colors.grey, fontSize: 14)),
            const SizedBox(height: 32),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () => Navigator.of(context).pop(),
                style: ElevatedButton.styleFrom(
                  backgroundColor: color,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
                child: Text('Back to Dashboard', style: GoogleFonts.inter(fontWeight: FontWeight.w600)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildErrorView() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, size: 64, color: Color(0xFFEF4444)),
            const SizedBox(height: 16),
            Text(_error ?? 'Something went wrong',
              textAlign: TextAlign.center,
              style: GoogleFonts.inter(color: const Color(0xFFEF4444), fontSize: 14, height: 1.5)),
            const SizedBox(height: 24),
            ElevatedButton(
              onPressed: () => setState(() { _step = 'ready'; _error = null; _livenessPassed = false; }),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFFF4D4D),
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
              child: Text('Try Again', style: GoogleFonts.inter(fontWeight: FontWeight.w600)),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Face bounding box painter ────────────────────────────
class _FaceBoxPainter extends CustomPainter {
  final Face face;
  final Size previewSize;
  const _FaceBoxPainter(this.face, this.previewSize);

  @override
  void paint(Canvas canvas, Size size) {
    final scaleX = size.width / previewSize.height;
    final scaleY = size.height / previewSize.width;
    final box = face.boundingBox;

    final rect = Rect.fromLTRB(
      box.left * scaleX,
      box.top * scaleY,
      box.right * scaleX,
      box.bottom * scaleY,
    );

    canvas.drawRect(
      rect,
      Paint()
        ..color = const Color(0xFFFF4D4D)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.5,
    );
  }

  @override
  bool shouldRepaint(_FaceBoxPainter old) => old.face != face;
}
