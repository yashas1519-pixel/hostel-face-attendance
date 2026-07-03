import 'package:flutter/material.dart';
import 'package:hostel_attendance/services/auth_service.dart';
import 'package:hostel_attendance/screens/login_screen.dart';
import 'package:hostel_attendance/screens/check_in_screen.dart';
import 'package:hostel_attendance/screens/enrollment_screen.dart';

class StudentDashboard extends StatefulWidget {
  const StudentDashboard({super.key});

  @override
  State<StudentDashboard> createState() => _StudentDashboardState();
}

class _StudentDashboardState extends State<StudentDashboard> {
  Map<String, dynamic>? _user;
  List<dynamic> _history = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() { _loading = true; _error = null; });
    try {
      // Always refresh user from server to get latest enrollmentStatus
      final user = await AuthService.refreshUser();
      final historyRes = await AuthService.get('/attendance/history?page=1&limit=10');
      setState(() {
        _user = user;
        _history = (historyRes['data'] as List?) ?? [];
        _loading = false;
      });
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _logout() async {
    await AuthService.logout();
    if (mounted) {
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => const LoginScreen()),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Dashboard', style: TextStyle(fontWeight: FontWeight.bold)),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout, size: 20),
            onPressed: _logout,
            tooltip: 'Logout',
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(_error!, style: const TextStyle(color: Color(0xFFEF4444))),
                    const SizedBox(height: 12),
                    ElevatedButton(onPressed: _loadData, child: const Text('Retry')),
                  ],
                ))
              : RefreshIndicator(
                  onRefresh: _loadData,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      // Welcome card
                      _buildWelcomeCard(),
                      const SizedBox(height: 16),
                      // Enrollment status card
                      _buildEnrollmentCard(),
                      const SizedBox(height: 16),
                      // Check-in button
                      _buildCheckInButton(),
                      const SizedBox(height: 24),
                      // History
                      const Text('Recent Check-ins', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
                      const SizedBox(height: 12),
                      if (_history.isEmpty)
                        _buildEmptyState()
                      else
                        ..._history.map(_buildHistoryTile),
                    ],
                  ),
                ),
    );
  }

  Widget _buildWelcomeCard() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFFFF4D4D), Color(0xFFFF6B35)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Hello, ${_user?['name'] ?? 'Student'} 👋',
            style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: Colors.white),
          ),
          const SizedBox(height: 4),
          Text(
            'Roll: ${_user?['rollNumber'] ?? '—'}',
            style: const TextStyle(color: Colors.white70, fontSize: 14),
          ),
        ],
      ),
    );
  }

  Widget _buildEnrollmentCard() {
    final status = _user?['enrollmentStatus'] ?? 'none';
    final Color statusColor;
    final String statusText;
    final IconData statusIcon;

    switch (status) {
      case 'approved':
        statusColor = const Color(0xFF34D399);
        statusText = 'Face Enrolled ✓';
        statusIcon = Icons.check_circle;
      case 'pending':
        statusColor = const Color(0xFFFBBF24);
        statusText = 'Enrollment Pending';
        statusIcon = Icons.hourglass_top;
      case 'rejected':
        statusColor = const Color(0xFFEF4444);
        statusText = 'Enrollment Rejected';
        statusIcon = Icons.cancel;
      default:
        statusColor = const Color(0xFF888888);
        statusText = 'Not Enrolled';
        statusIcon = Icons.face_retouching_off;
    }

    return Card(
      child: ListTile(
        leading: Icon(statusIcon, color: statusColor, size: 28),
        title: Text(statusText, style: TextStyle(color: statusColor, fontWeight: FontWeight.w600)),
        subtitle: status == 'none' || status == 'rejected'
            ? Text(
                status == 'rejected' ? 'Tap to re-enroll' : 'Tap to start face enrollment',
                style: const TextStyle(fontSize: 12),
              )
            : null,
        trailing: status == 'none' || status == 'rejected'
            ? const Icon(Icons.arrow_forward_ios, size: 16)
            : null,
        onTap: status == 'none' || status == 'rejected'
            ? () => Navigator.of(context)
                .push(MaterialPageRoute(builder: (_) => const EnrollmentScreen()))
                .then((_) => _loadData())
            : null,
      ),
    );
  }

  Widget _buildCheckInButton() {
    final enrolled = _user?['enrollmentStatus'] == 'approved';
    return SizedBox(
      width: double.infinity,
      height: 56,
      child: ElevatedButton.icon(
        onPressed: enrolled
            ? () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const CheckInScreen()),
              )
            : null,
        icon: const Icon(Icons.camera_alt, size: 22),
        label: const Text('Mark Attendance'),
        style: ElevatedButton.styleFrom(
          disabledBackgroundColor: const Color(0xFF333333),
          disabledForegroundColor: const Color(0xFF666666),
        ),
      ),
    );
  }

  Widget _buildEmptyState() {
    return Container(
      padding: const EdgeInsets.all(32),
      alignment: Alignment.center,
      child: Column(
        children: [
          Icon(Icons.history, size: 48, color: Colors.grey[700]),
          const SizedBox(height: 12),
          Text('No check-ins yet', style: TextStyle(color: Colors.grey[600], fontSize: 14)),
        ],
      ),
    );
  }

  Widget _buildHistoryTile(dynamic record) {
    final r = record as Map<String, dynamic>;
    final status = r['status'] as String? ?? 'unknown';
    final Color color = status == 'present'
        ? const Color(0xFF34D399)
        : status == 'flagged'
            ? const Color(0xFFFBBF24)
            : const Color(0xFFEF4444);
    final time = r['markedAt'] != null
        ? DateTime.tryParse(r['markedAt'] as String)?.toLocal().toString().substring(0, 16) ?? '—'
        : '—';

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: color.withValues(alpha: 0.15),
          child: Icon(
            status == 'present' ? Icons.check : status == 'flagged' ? Icons.warning : Icons.close,
            color: color,
            size: 20,
          ),
        ),
        title: Text(status.toUpperCase(), style: TextStyle(color: color, fontWeight: FontWeight.w600, fontSize: 13)),
        subtitle: Text(time, style: const TextStyle(fontSize: 12)),
        trailing: Text(
          'Score: ${(r['faceMatchScore'] as num?)?.toStringAsFixed(2) ?? '—'}',
          style: const TextStyle(fontSize: 12, color: Color(0xFF888888)),
        ),
      ),
    );
  }
}
