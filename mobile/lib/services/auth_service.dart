import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Secure token storage — uses:
///   iOS:     Keychain Services
///   Android: EncryptedSharedPreferences (AES-256 via AndroidKeyStore)
///
/// Never use SharedPreferences for tokens — it is plaintext on unrooted Android
/// and accessible without encryption on rooted devices.
class AuthService {
  static const _baseUrl = String.fromEnvironment(
    'API_URL',
    defaultValue: 'https://hostel-face-attendance.onrender.com',
  );
  static const _tokenKey = 'access_token';
  static const _refreshKey = 'refresh_token';
  static const _userKey = 'user_data';

  // ponytail: one instance, iOS options enforce this partition
  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
    iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
  );

  static Future<String?> getToken() => _storage.read(key: _tokenKey);
  static Future<String?> getRefreshToken() => _storage.read(key: _refreshKey);

  static Future<Map<String, dynamic>?> getUser() async {
    final data = await _storage.read(key: _userKey);
    return data != null ? jsonDecode(data) as Map<String, dynamic> : null;
  }

  static Future<void> _saveAuth(
    String accessToken,
    String refreshToken,
    Map<String, dynamic> user,
  ) async {
    await Future.wait([
      _storage.write(key: _tokenKey, value: accessToken),
      _storage.write(key: _refreshKey, value: refreshToken),
      _storage.write(key: _userKey, value: jsonEncode(user)),
    ]);
  }

  static Future<void> logout() async {
    // Revoke refresh token on server (best-effort)
    try {
      final refreshToken = await getRefreshToken();
      final accessToken = await getToken();
      if (refreshToken != null && accessToken != null) {
        await http.post(
          Uri.parse('$_baseUrl/auth/logout'),
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer $accessToken',
          },
          body: jsonEncode({'refreshToken': refreshToken}),
        );
      }
    } catch (_) {
      // Best-effort — clear local storage regardless
    }
    await _storage.deleteAll();
  }

  /// Refresh access token using stored refresh token.
  /// Called automatically when a 401 is received.
  static Future<bool> tryRefresh() async {
    try {
      final refreshToken = await getRefreshToken();
      if (refreshToken == null) return false;
      final res = await http.post(
        Uri.parse('$_baseUrl/auth/refresh'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'refreshToken': refreshToken}),
      );
      if (res.statusCode != 200 && res.statusCode != 201) return false;
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      await _saveAuth(
        data['accessToken'] as String,
        data['refreshToken'] as String,
        data['user'] as Map<String, dynamic>,
      );
      return true;
    } catch (_) {
      return false;
    }
  }

  static Future<Map<String, dynamic>> login(String email, String password) async {
    final res = await http.post(
      Uri.parse('$_baseUrl/auth/login'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'email': email, 'password': password}),
    );
    if (res.statusCode != 200 && res.statusCode != 201) {
      final body = jsonDecode(res.body);
      throw Exception(body['message'] ?? 'Login failed');
    }
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    await _saveAuth(
      data['accessToken'] as String,
      data['refreshToken'] as String,
      data['user'] as Map<String, dynamic>,
    );
    return data;
  }

  static Future<Map<String, dynamic>> register({
    required String email,
    required String password,
    required String name,
    required String rollNumber,
    required String collegeName,
  }) async {
    final res = await http.post(
      Uri.parse('$_baseUrl/auth/register'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'email': email,
        'password': password,
        'name': name,
        'role': 'student',
        'rollNumber': rollNumber,
        'collegeName': collegeName,
      }),
    );
    if (res.statusCode != 200 && res.statusCode != 201) {
      final body = jsonDecode(res.body);
      throw Exception(body['message'] ?? 'Registration failed');
    }
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    await _saveAuth(
      data['accessToken'] as String,
      data['refreshToken'] as String,
      data['user'] as Map<String, dynamic>,
    );
    return data;
  }

  /// Authenticated GET — auto-retries once with refreshed token on 401.
  static Future<Map<String, dynamic>> get(String path) async {
    return _withAutoRefresh(() async {
      final token = await getToken();
      final res = await http.get(
        Uri.parse('$_baseUrl$path'),
        headers: {
          'Content-Type': 'application/json',
          if (token != null) 'Authorization': 'Bearer $token',
        },
      );
      if (res.statusCode >= 400) {
        final body = jsonDecode(res.body) as Map<String, dynamic>;
        throw _ApiError(res.statusCode, body['message'] as String? ?? 'Request failed');
      }
      return jsonDecode(res.body) as Map<String, dynamic>;
    });
  }

  /// Authenticated POST — auto-retries once with refreshed token on 401.
  static Future<Map<String, dynamic>> post(String path, Map<String, dynamic> body) async {
    return _withAutoRefresh(() async {
      final token = await getToken();
      final res = await http.post(
        Uri.parse('$_baseUrl$path'),
        headers: {
          'Content-Type': 'application/json',
          if (token != null) 'Authorization': 'Bearer $token',
        },
        body: jsonEncode(body),
      );
      if (res.statusCode >= 400) {
        final b = jsonDecode(res.body) as Map<String, dynamic>;
        throw _ApiError(res.statusCode, b['message'] as String? ?? 'Request failed');
      }
      return jsonDecode(res.body) as Map<String, dynamic>;
    });
  }

  /// Wraps a request: on 401, tries to refresh then retries once.
  static Future<Map<String, dynamic>> _withAutoRefresh(
    Future<Map<String, dynamic>> Function() fn,
  ) async {
    try {
      return await fn();
    } on _ApiError catch (e) {
      if (e.statusCode == 401) {
        final refreshed = await tryRefresh();
        if (refreshed) return fn(); // retry with new token
        await logout();
        throw Exception('Session expired. Please log in again.');
      }
      throw Exception(e.message);
    }
  }

  static Future<Map<String, dynamic>> refreshUser() async {
    final data = await get('/auth/me');
    await _storage.write(key: _userKey, value: jsonEncode(data));
    return data;
  }

  static Future<Map<String, dynamic>?> getActiveWindow(String hostelId) async {
    try {
      return await get('/hostel/$hostelId/active-window');
    } catch (_) {
      return null;
    }
  }

  static Future<String?> getMyHostelId() async {
    try {
      final user = await refreshUser();
      return user['hostelId'] as String?;
    } catch (_) {
      return null;
    }
  }
}

class _ApiError implements Exception {
  final int statusCode;
  final String message;
  const _ApiError(this.statusCode, this.message);
}
