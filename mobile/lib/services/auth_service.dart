import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// ponytail: one service handles all API + token management — no extra abstractions
class AuthService {
  // ponytail: env-configurable in prod, hardcoded for dev
  static const _baseUrl = String.fromEnvironment('API_URL', defaultValue: 'http://localhost:3000');
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
    if (res.statusCode != 201) {
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
    if (res.statusCode != 201) {
      final body = jsonDecode(res.body);
      throw Exception(body['message'] ?? 'Registration failed');
    }
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    await _saveAuth(data['token'] as String, data['user'] as Map<String, dynamic>);
    return data;
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
    return jsonDecode(res.body) as Map<String, dynamic>;
  }
}
