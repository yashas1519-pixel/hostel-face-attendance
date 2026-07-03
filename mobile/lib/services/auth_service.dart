import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// ponytail: one service handles all API + token management — no extra abstractions
class AuthService {
  static const _baseUrl = String.fromEnvironment(
    'API_URL',
    defaultValue: 'https://hostel-face-attendance.onrender.com',
  );
  static const _tokenKey = 'jwt_token';
  static const _userKey = 'user_data';

  static Future<String?> getToken() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_tokenKey);
  }

  static Future<Map<String, dynamic>?> getUser() async {
    final prefs = await SharedPreferences.getInstance();
    final data = prefs.getString(_userKey);
    return data != null ? jsonDecode(data) as Map<String, dynamic> : null;
  }

  static Future<void> _saveAuth(String token, Map<String, dynamic> user) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_tokenKey, token);
    await prefs.setString(_userKey, jsonEncode(user));
  }

  static Future<void> logout() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_tokenKey);
    await prefs.remove(_userKey);
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
    await _saveAuth(data['token'] as String, data['user'] as Map<String, dynamic>);
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
    await _saveAuth(data['token'] as String, data['user'] as Map<String, dynamic>);
    return data;
  }

  /// Refresh user profile from /auth/me and update local cache
  static Future<Map<String, dynamic>> refreshUser() async {
    final token = await getToken();
    final res = await http.get(
      Uri.parse('$_baseUrl/auth/me'),
      headers: {
        'Content-Type': 'application/json',
        if (token != null) 'Authorization': 'Bearer $token',
      },
    );
    if (res.statusCode == 401) {
      await logout();
      throw Exception('Session expired');
    }
    final user = jsonDecode(res.body) as Map<String, dynamic>;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_userKey, jsonEncode(user));
    return user;
  }

  /// Authenticated GET request
  static Future<Map<String, dynamic>> get(String path) async {
    final token = await getToken();
    final res = await http.get(
      Uri.parse('$_baseUrl$path'),
      headers: {
        'Content-Type': 'application/json',
        if (token != null) 'Authorization': 'Bearer $token',
      },
    );
    if (res.statusCode == 401) {
      await logout();
      throw Exception('Session expired');
    }
    if (res.statusCode >= 400) {
      final body = jsonDecode(res.body) as Map<String, dynamic>;
      throw Exception(body['message'] ?? 'Request failed (${res.statusCode})');
    }
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  /// Authenticated POST request
  static Future<Map<String, dynamic>> post(String path, Map<String, dynamic> body) async {
    final token = await getToken();
    final res = await http.post(
      Uri.parse('$_baseUrl$path'),
      headers: {
        'Content-Type': 'application/json',
        if (token != null) 'Authorization': 'Bearer $token',
      },
      body: jsonEncode(body),
    );
    if (res.statusCode == 401) {
      await logout();
      throw Exception('Session expired');
    }
    if (res.statusCode >= 400) {
      final body2 = jsonDecode(res.body) as Map<String, dynamic>;
      throw Exception(body2['message'] ?? 'Request failed (${res.statusCode})');
    }
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  /// GET the currently active check-in window for a hostel (null = none active)
  static Future<Map<String, dynamic>?> getActiveWindow(String hostelId) async {
    try {
      final res = await get('/hostel/$hostelId/active-window');
      return res;
    } catch (_) {
      return null;
    }
  }

  /// GET student's assigned hostel from their assignment
  static Future<String?> getMyHostelId() async {
    try {
      final user = await refreshUser();
      // The assignment hostelId is stored in the user record after admin assigns
      return user['hostelId'] as String?;
    } catch (_) {
      return null;
    }
  }
}
