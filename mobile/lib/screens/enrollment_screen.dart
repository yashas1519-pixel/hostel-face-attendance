import 'dart:async';
import 'package:flutter/material.dart';
import 'package:camera/camera.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import 'package:google_fonts/google_fonts.dart';
import '../services/auth_service.dart';
import '../services/face_service.dart';

class EnrollmentScreen extends StatefulWidget {
  const EnrollmentScreen({super.key});

  @override
  State<EnrollmentScreen> createState() => _EnrollmentScreenState();
}

class _EnrollmentScreenState extends State<EnrollmentScreen>
    with TickerProviderStateMixin {
  CameraController? _cam;
  String _step = 'init'; // init → ready → capturing → submitting → done | error
  String? _error;
  int _capturedFrames = 0;
  final List<List<double>> _embeddings = [];
  Face? _detectedFace;
  Timer? _frameTimer;
  late AnimationController _pulseCtrl;
  late Animation<double> _pulse;

  static const _captureSteps = [
    'Look straight at the camera',
    'Turn your head slightly RIGHT →',
    '← Turn your head slightly LEFT',
  ];

  @override
  void initState() {
    super.initState();
    _pulseCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 800),
    )..repeat(reverse: true);
    _pulse = Tween(begin: 0.95, end: 1.05).animate(
      CurvedAnimation(parent: _pulseCtrl, curve: Curves.easeInOut),
    );
    _initCamera();
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
        ResolutionPreset.high,
        enableAudio: false,
        imageFormatGroup: ImageFormatGroup.nv21,
      );
      await _cam!.initialize();
      if (mounted) setState(() => _step = 'ready');
    } catch (e) {
      if (mounted) setState(() { _error = 'Camera failed: $e'; _step = 'error'; });
    }
  }

  void _startCapture() {
    setState(() { _step = 'capturing'; _capturedFrames = 0; _embeddings.clear(); });
    _captureNextFrame();
  }

  void _captureNextFrame() {
    if (_capturedFrames >= 3) {
      _submit();
      return;
    }
    // Give user 2s to position, then capture
    _frameTimer = Timer(const Duration(seconds: 2), () async {
      if (!mounted || _cam == null) return;
      try {
        final cam = _cam!;
        await cam.startImageStream((img) async {
          await cam.stopImageStream();
          final input = FaceService.cameraImageToInput(
            img,
            cam.description,
          );
          if (input == null) {
            if (mounted) setState(() { _error = 'Image format not supported'; _step = 'error'; });
            return;
          }
          final faces = await FaceService.detectFaces(input);
          if (faces.isEmpty) {
            if (mounted) {
              _showSnack('No face detected — please try again');
              setState(() { _step = 'ready'; _capturedFrames = 0; _embeddings.clear(); });
            }
            return;
          }
          final embedding = FaceService.extractEmbedding(faces.first);
          _embeddings.add(embedding);
          if (mounted) setState(() { _capturedFrames++; _detectedFace = faces.first; });
          _captureNextFrame();
        });
      } catch (e) {
        if (mounted) setState(() { _error = e.toString(); _step = 'error'; });
      }
    });
  }

  Future<void> _submit() async {
    setState(() => _step = 'submitting');
    try {
      final avg = FaceService.averageEmbeddings(_embeddings);
      await AuthService.post('/enrollment/submit', {'embedding': avg});
      await AuthService.refreshUser();
      if (mounted) setState(() => _step = 'done');
    } catch (e) {
      if (mounted) setState(() { _error = e.toString().replaceFirst('Exception: ', ''); _step = 'error'; });
    }
  }

  void _showSnack(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: const Color(0xFF333333)),
    );
  }

  @override
  void dispose() {
    _frameTimer?.cancel();
    _pulseCtrl.dispose();
    _cam?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0A0A0A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF111111),
        title: Text('Face Enrollment', style: GoogleFonts.inter(fontWeight: FontWeight.w600)),
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
      case 'init':
        return const Center(child: CircularProgressIndicator(color: Color(0xFFFF4D4D)));
      case 'ready':
        return _buildReadyView();
      case 'capturing':
        return _buildCapturingView();
      case 'submitting':
        return _buildSubmittingView();
      case 'done':
        return _buildDoneView();
      case 'error':
        return _buildErrorView();
      default:
        return const SizedBox();
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
                ClipRRect(
                  child: SizedBox(
                    width: double.infinity,
                    child: CameraPreview(_cam!),
                  ),
                ),
              // Oval face guide overlay
              CustomPaint(
                size: const Size(double.infinity, double.infinity),
                painter: _OvalGuidePainter(),
              ),
              // Instruction overlay at bottom
              Positioned(
                bottom: 20,
                left: 20,
                right: 20,
                child: Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: 0.7),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    'Position your face within the oval.\nWe\'ll capture 3 frames for accuracy.',
                    textAlign: TextAlign.center,
                    style: GoogleFonts.inter(color: Colors.white70, fontSize: 13),
                  ),
                ),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(24),
          child: SizedBox(
            width: double.infinity,
            height: 52,
            child: ElevatedButton(
              onPressed: _startCapture,
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFFF4D4D),
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
              child: Text('Start Enrollment', style: GoogleFonts.inter(fontWeight: FontWeight.w600, fontSize: 15)),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildCapturingView() {
    final stepIdx = _capturedFrames.clamp(0, 2);
    final instruction = _captureSteps[stepIdx];

    return Column(
      children: [
        Expanded(
          child: Stack(
            alignment: Alignment.center,
            children: [
              if (_cam != null && _cam!.value.isInitialized)
                SizedBox(width: double.infinity, child: CameraPreview(_cam!)),
              CustomPaint(
                size: const Size(double.infinity, double.infinity),
                painter: _OvalGuidePainter(active: true),
              ),
              Positioned(
                bottom: 20,
                left: 20,
                right: 20,
                child: Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFF4D4D).withValues(alpha: 0.85),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        'Step ${stepIdx + 1} of 3',
                        style: GoogleFonts.inter(color: Colors.white70, fontSize: 12),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        instruction,
                        textAlign: TextAlign.center,
                        style: GoogleFonts.inter(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 14),
                      ),
                      const SizedBox(height: 8),
                      // Progress dots
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: List.generate(3, (i) => AnimatedContainer(
                          duration: const Duration(milliseconds: 200),
                          margin: const EdgeInsets.symmetric(horizontal: 4),
                          width: i < _capturedFrames ? 20 : 8,
                          height: 8,
                          decoration: BoxDecoration(
                            color: i < _capturedFrames ? Colors.white : Colors.white38,
                            borderRadius: BorderRadius.circular(4),
                          ),
                        )),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildSubmittingView() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ScaleTransition(
            scale: _pulse,
            child: Container(
              padding: const EdgeInsets.all(28),
              decoration: const BoxDecoration(
                shape: BoxShape.circle,
                color: Color(0x22FF4D4D),
              ),
              child: const Icon(Icons.face_retouching_natural, size: 56, color: Color(0xFFFF4D4D)),
            ),
          ),
          const SizedBox(height: 24),
          Text('Uploading face data…', style: GoogleFonts.inter(fontSize: 16, color: Colors.white)),
          const SizedBox(height: 8),
          Text('Please wait', style: GoogleFonts.inter(color: Colors.grey, fontSize: 13)),
        ],
      ),
    );
  }

  Widget _buildDoneView() {
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
                color: const Color(0xFF34D399).withValues(alpha: 0.15),
              ),
              child: const Icon(Icons.check_circle_outline, size: 72, color: Color(0xFF34D399)),
            ),
            const SizedBox(height: 24),
            Text('Face Enrolled!', style: GoogleFonts.inter(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.white)),
            const SizedBox(height: 12),
            Text(
              'Your face data has been submitted.\nAwaiting admin approval before you can mark attendance.',
              textAlign: TextAlign.center,
              style: GoogleFonts.inter(color: Colors.grey, fontSize: 14, height: 1.5),
            ),
            const SizedBox(height: 32),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () => Navigator.of(context).pop(),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF34D399),
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
            Text(
              _error ?? 'Something went wrong',
              textAlign: TextAlign.center,
              style: GoogleFonts.inter(color: const Color(0xFFEF4444), fontSize: 14),
            ),
            const SizedBox(height: 24),
            ElevatedButton(
              onPressed: () => setState(() { _step = 'ready'; _error = null; }),
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

// ── Oval face guide painter ───────────────────────────────
class _OvalGuidePainter extends CustomPainter {
  final bool active;
  const _OvalGuidePainter({this.active = false});

  @override
  void paint(Canvas canvas, Size size) {
    final cx = size.width / 2;
    final cy = size.height * 0.42;
    final rx = size.width * 0.33;
    final ry = size.height * 0.28;

    // Dark overlay outside oval
    final outer = Path()..addRect(Rect.fromLTWH(0, 0, size.width, size.height));
    final oval = Path()..addOval(Rect.fromCenter(center: Offset(cx, cy), width: rx * 2, height: ry * 2));
    final cutout = Path.combine(PathOperation.difference, outer, oval);

    canvas.drawPath(cutout, Paint()..color = Colors.black.withValues(alpha: 0.55));

    // Border ring
    canvas.drawOval(
      Rect.fromCenter(center: Offset(cx, cy), width: rx * 2, height: ry * 2),
      Paint()
        ..color = active ? const Color(0xFFFF4D4D) : Colors.white54
        ..style = PaintingStyle.stroke
        ..strokeWidth = active ? 3 : 2,
    );
  }

  @override
  bool shouldRepaint(_OvalGuidePainter old) => old.active != active;
}
