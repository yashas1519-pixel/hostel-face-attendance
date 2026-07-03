import 'package:flutter/material.dart';
import 'package:hostel_attendance/services/auth_service.dart';
import 'package:hostel_attendance/screens/student_dashboard.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailCtl = TextEditingController();
  final _passwordCtl = TextEditingController();
  bool _loading = false;
  bool _isRegister = false;
  final _nameCtl = TextEditingController();
  final _rollCtl = TextEditingController();
  final _collegeCtl = TextEditingController();
  String? _error;

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() { _loading = true; _error = null; });

    try {
      if (_isRegister) {
        await AuthService.register(
          email: _emailCtl.text.trim(),
          password: _passwordCtl.text,
          name: _nameCtl.text.trim(),
          rollNumber: _rollCtl.text.trim(),
          collegeName: _collegeCtl.text.trim(),
        );
      } else {
        await AuthService.login(_emailCtl.text.trim(), _passwordCtl.text);
      }
      if (mounted) {
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => const StudentDashboard()),
        );
      }
    } catch (e) {
      setState(() { _error = e.toString().replaceFirst('Exception: ', ''); });
    } finally {
      if (mounted) setState(() { _loading = false; });
    }
  }

  @override
  void dispose() {
    _emailCtl.dispose();
    _passwordCtl.dispose();
    _nameCtl.dispose();
    _rollCtl.dispose();
    _collegeCtl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 400),
            child: Form(
              key: _formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  // Logo / Title
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [Color(0xFFFF4D4D), Color(0xFFFF6B35)],
                      ),
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: const Icon(Icons.face, size: 48, color: Colors.white),
                  ),
                  const SizedBox(height: 24),
                  Text(
                    _isRegister ? 'Create Account' : 'Welcome Back',
                    style: const TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    _isRegister ? 'Register for hostel attendance' : 'Sign in to mark attendance',
                    style: TextStyle(color: Colors.grey[500], fontSize: 14),
                  ),
                  const SizedBox(height: 32),

                  if (_error != null)
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(12),
                      margin: const EdgeInsets.only(bottom: 16),
                      decoration: BoxDecoration(
                        color: const Color(0x1AEF4444),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: const Color(0x33EF4444)),
                      ),
                      child: Text(_error!, style: const TextStyle(color: Color(0xFFEF4444), fontSize: 13)),
                    ),

                  if (_isRegister) ...[
                    _field(_nameCtl, 'Full Name', Icons.person_outline),
                    const SizedBox(height: 12),
                    _field(_rollCtl, 'Roll Number', Icons.badge_outlined),
                    const SizedBox(height: 12),
                    _field(_collegeCtl, 'College Name', Icons.school_outlined),
                    const SizedBox(height: 12),
                  ],
                  _field(_emailCtl, 'Email', Icons.email_outlined, type: TextInputType.emailAddress),
                  const SizedBox(height: 12),
                  _field(_passwordCtl, 'Password', Icons.lock_outline, obscure: true),
                  const SizedBox(height: 24),

                  SizedBox(
                    width: double.infinity,
                    height: 52,
                    child: ElevatedButton(
                      onPressed: _loading ? null : _submit,
                      child: _loading
                          ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                          : Text(_isRegister ? 'Register' : 'Sign In'),
                    ),
                  ),
                  const SizedBox(height: 16),

                  TextButton(
                    onPressed: () => setState(() { _isRegister = !_isRegister; _error = null; }),
                    child: Text(
                      _isRegister ? 'Already have an account? Sign In' : 'New student? Create Account',
                      style: const TextStyle(color: Color(0xFFFF4D4D)),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _field(TextEditingController ctl, String label, IconData icon, {bool obscure = false, TextInputType? type}) {
    return TextFormField(
      controller: ctl,
      obscureText: obscure,
      keyboardType: type,
      validator: (v) => (v == null || v.isEmpty) ? '$label is required' : null,
      decoration: InputDecoration(
        labelText: label,
        prefixIcon: Icon(icon, size: 20),
      ),
    );
  }
}
