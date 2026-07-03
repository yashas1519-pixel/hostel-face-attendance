import 'dart:async';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:camera/camera.dart';
import 'package:geolocator/geolocator.dart';
import 'package:network_info_plus/network_info_plus.dart';
import 'package:hostel_attendance/services/auth_service.dart';

/// ponytail: combined check-in screen — camera + liveness + geofence in one flow
class CheckInScreen extends StatefulWidget {
  const CheckInScreen({super.key});

  @override
  State<CheckInScreen> createState() => _CheckInScreenState();
}

class _CheckInScreenState extends State<CheckInScreen> {
  CameraController? _camCtl;
  String _step = 'init'; // init → challenge → processing → result
  String? _challenge;
  bool _livenessPassed = false;
  double _parallaxRatio = 0;
  Timer? _timer;
  int _countdown = 4;
  String? _error;
  String? _resultStatus;

  static const _challenges = ['turn_right', 'turn_left', 'blink'];
  static const _challengeLabels = {
    'turn_right': 'Turn your head RIGHT →',
    'turn_left': '← Turn your head LEFT',
    'blink': 'BLINK both eyes 👀',
  };

  @override
  void initState() {
    super.initState();
    _initCamera();
  }

  Future<void> _initCamera() async {
    try {
      final cameras = await availableCameras();
      final front = cameras.firstWhere(
        (c) => c.lensDirection == CameraLensDirection.front,
        orElse: () => cameras.first,
      );
      _camCtl = CameraController(front, ResolutionPreset.medium, enableAudio: false);
      await _camCtl!.initialize();
      if (mounted) setState(() { _step = 'ready'; });
    } catch (e) {
      if (mounted) setState(() { _error = 'Camera init failed: $e'; _step = 'error'; });
    }
  }

  void _startChallenge() {
    final rng = Random();
    _challenge = _challenges[rng.nextInt(_challenges.length)];
    _countdown = 4;
    _livenessPassed = false;
    // ponytail: simulate liveness pass for MVP — real ML Kit integration in Phase 3
    // In production, this uses google_mlkit_face_detection Euler angles + MediaPipe parallax
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) { t.cancel(); return; }
      setState(() { _countdown--; });
      if (_countdown <= 0) {
        t.cancel();
        // ponytail: simulated liveness result for dev — replace with ML Kit
        _livenessPassed = true;
        _parallaxRatio = 1.35 + rng.nextDouble() * 0.3; // simulated real-face parallax
        _submitAttendance();
      }
    });
    setState(() { _step = 'challenge'; });
  }

  Future<void> _submitAttendance() async {
    setState(() { _step = 'processing'; });

    try {
      // Get GPS location
      final permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        await Geolocator.requestPermission();
      }
      final pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
      );

      // Get WiFi BSSID
      final networkInfo = NetworkInfo();
      final bssid = await networkInfo.getWifiBSSID();

      // ponytail: dummy embedding for dev — in prod this comes from MobileFaceNet TFLite
      final embedding = List.generate(128, (i) => (Random().nextDouble() - 0.5) * 2);

      final user = await AuthService.getUser();
      final result = await AuthService.post('/attendance/mark', {
        'hostelId': user?['hostelId'] ?? '',
        'checkInWindowId': '', // ponytail: fetch active window from API in prod
        'embedding': embedding,
        'livenessAction': _challenge,
        'livenessPassed': _livenessPassed,
        'parallaxRatio': _parallaxRatio,
        'deviceLat': pos.latitude,
        'deviceLng': pos.longitude,
        'gpsAccuracyM': pos.accuracy,
        'wifiBssid': bssid ?? '',
        'mockLocationFlag': pos.isMocked,
        'deviceId': 'device-${user?['id'] ?? 'unknown'}',
      });

      setState(() {
        _resultStatus = result['status'] as String? ?? 'unknown';
        _step = 'result';
      });
    } catch (e) {
      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
        _step = 'error';
      });
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _camCtl?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Check In')),
      body: switch (_step) {
        'init' => const Center(child: CircularProgressIndicator()),
        'ready' => _buildReadyView(),
        'challenge' => _buildChallengeView(),
        'processing' => _buildProcessingView(),
        'result' => _buildResultView(),
        'error' => _buildErrorView(),
        _ => const Center(child: Text('Unknown state')),
      },
    );
  }

  Widget _buildReadyView() {
    return Column(
      children: [
        Expanded(
          child: _camCtl != null && _camCtl!.value.isInitialized
              ? ClipRRect(
                  borderRadius: const BorderRadius.vertical(bottom: Radius.circular(24)),
                  child: CameraPreview(_camCtl!),
                )
              : const Center(child: CircularProgressIndicator()),
        ),
        Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            children: [
              const Text(
                'Position your face in the frame',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w500),
              ),
              const SizedBox(height: 8),
              Text(
                'A random liveness challenge will appear.\nComplete it within 4 seconds.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.grey[500], fontSize: 13),
              ),
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                height: 52,
                child: ElevatedButton(
                  onPressed: _startChallenge,
                  child: const Text('Start Check-in'),
                ),
              ),
            ],
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
              if (_camCtl != null && _camCtl!.value.isInitialized)
                CameraPreview(_camCtl!),
              // Overlay
              Container(
                decoration: BoxDecoration(
                  border: Border.all(color: const Color(0xFFFF4D4D), width: 3),
                  borderRadius: BorderRadius.circular(200),
                ),
                width: 260,
                height: 340,
              ),
            ],
          ),
        ),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(24),
          decoration: const BoxDecoration(
            color: Color(0xFF1A1A1A),
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          ),
          child: Column(
            children: [
              Text(
                _challengeLabels[_challenge] ?? '',
                style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: Color(0xFFFF4D4D)),
              ),
              const SizedBox(height: 12),
              Text(
                '$_countdown',
                style: const TextStyle(fontSize: 48, fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 8),
              Text('seconds remaining', style: TextStyle(color: Colors.grey[500], fontSize: 13)),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildProcessingView() {
    return const Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          CircularProgressIndicator(color: Color(0xFFFF4D4D)),
          SizedBox(height: 24),
          Text('Verifying attendance...', style: TextStyle(fontSize: 16)),
          SizedBox(height: 8),
          Text('Checking face, liveness, and location', style: TextStyle(color: Color(0xFF888888), fontSize: 13)),
        ],
      ),
    );
  }

  Widget _buildResultView() {
    final success = _resultStatus == 'present';
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: success ? const Color(0x1A34D399) : const Color(0x1AEF4444),
              ),
              child: Icon(
                success ? Icons.check_circle : Icons.cancel,
                size: 72,
                color: success ? const Color(0xFF34D399) : const Color(0xFFEF4444),
              ),
            ),
            const SizedBox(height: 24),
            Text(
              success ? 'Attendance Marked!' : 'Check-in Failed',
              style: TextStyle(
                fontSize: 24,
                fontWeight: FontWeight.bold,
                color: success ? const Color(0xFF34D399) : const Color(0xFFEF4444),
              ),
            ),
            if (!success && _resultStatus != null) ...[
              const SizedBox(height: 8),
              Text('Status: $_resultStatus', style: const TextStyle(color: Color(0xFF888888))),
            ],
            const SizedBox(height: 32),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('Back to Dashboard'),
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
            Text(_error ?? 'Something went wrong', textAlign: TextAlign.center, style: const TextStyle(color: Color(0xFFEF4444))),
            const SizedBox(height: 24),
            ElevatedButton(
              onPressed: () => setState(() { _step = 'ready'; _error = null; }),
              child: const Text('Try Again'),
            ),
          ],
        ),
      ),
    );
  }
}
