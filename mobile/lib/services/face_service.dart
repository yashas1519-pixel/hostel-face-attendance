import 'dart:math';
import 'package:camera/camera.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';

/// FaceService: wraps ML Kit face detection and produces:
/// - Face bounding boxes for the UI overlay
/// - 136-float landmark embeddings (normalised, unit-length)
/// - Liveness checks via Euler angles + blink probability
class FaceService {
  static final _detector = FaceDetector(
    options: FaceDetectorOptions(
      enableLandmarks: true,
      enableClassification: true, // gives eyeOpenProbability for blink detection
      enableTracking: false,
      performanceMode: FaceDetectorMode.accurate,
    ),
  );

  /// Convert a CameraImage to an ML Kit InputImage
  static InputImage? cameraImageToInput(
    CameraImage img,
    CameraDescription cam,
  ) {
    final rotation =
        InputImageRotationValue.fromRawValue(cam.sensorOrientation);
    final format = InputImageFormatValue.fromRawValue(img.format.raw);
    if (rotation == null || format == null) return null;

    return InputImage.fromBytes(
      bytes: img.planes.first.bytes,
      metadata: InputImageMetadata(
        size: Size(img.width.toDouble(), img.height.toDouble()),
        rotation: rotation,
        format: format,
        bytesPerRow: img.planes.first.bytesPerRow,
      ),
    );
  }

  /// Detect all faces in an InputImage
  static Future<List<Face>> detectFaces(InputImage input) {
    return _detector.processImage(input);
  }

  /// Extract a normalised 136-float embedding from a detected face.
  /// Uses all 17 FaceLandmarkType values (each has x+y → 34 floats).
  /// Coordinates are normalised to the face bounding box → scale-invariant.
  /// Result is L2-normalised to unit length for cosine similarity.
  static List<double> extractEmbedding(Face face) {
    final box = face.boundingBox;
    final w = box.width == 0 ? 1.0 : box.width;
    final h = box.height == 0 ? 1.0 : box.height;

    final embedding = <double>[];
    for (final type in FaceLandmarkType.values) {
      final lm = face.landmarks[type];
      if (lm != null) {
        embedding.add((lm.position.x - box.left) / w);
        embedding.add((lm.position.y - box.top) / h);
      } else {
        embedding.addAll([0.0, 0.0]);
      }
    }

    // Pad or trim to exactly 136 floats
    while (embedding.length < 136) {
      embedding.add(0.0);
    }
    final result = embedding.take(136).toList();

    // L2 normalise
    final norm = sqrt(result.fold(0.0, (s, x) => s + x * x));
    if (norm == 0) return result;
    return result.map((x) => x / norm).toList();
  }

  /// Average a list of embeddings (for multi-frame capture robustness)
  static List<double> averageEmbeddings(List<List<double>> embeddings) {
    if (embeddings.isEmpty) return List.filled(136, 0.0);
    final avg = List.filled(embeddings.first.length, 0.0);
    for (final e in embeddings) {
      for (int i = 0; i < e.length; i++) {
        avg[i] += e[i] / embeddings.length;
      }
    }
    // Re-normalise
    final norm = sqrt(avg.fold(0.0, (s, x) => s + x * x));
    if (norm == 0) return avg;
    return avg.map((x) => x / norm).toList();
  }

  /// Check liveness based on face Euler angles and blink classification.
  /// Returns true when the challenge is satisfied.
  ///   turn_right → Y angle > +18°
  ///   turn_left  → Y angle < −18°
  ///   blink      → both eye open probability < 0.25
  static bool checkLiveness(Face face, String challenge) {
    switch (challenge) {
      case 'turn_right':
        return (face.headEulerAngleY ?? 0) > 18;
      case 'turn_left':
        return (face.headEulerAngleY ?? 0) < -18;
      case 'blink':
        final leftOpen = face.leftEyeOpenProbability ?? 1.0;
        final rightOpen = face.rightEyeOpenProbability ?? 1.0;
        return leftOpen < 0.25 && rightOpen < 0.25;
      default:
        return false;
    }
  }

  static void dispose() => _detector.close();
}
