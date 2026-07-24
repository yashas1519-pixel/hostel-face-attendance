"use client";

import { useRouter } from "next/navigation";

export default function PrivacyPolicyPage() {
  const router = useRouter();

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0a0f",
      color: "#e0e0e0",
      fontFamily: "'Inter', -apple-system, sans-serif",
      padding: "40px 20px",
    }}>
      <div style={{
        maxWidth: 800,
        margin: "0 auto",
        background: "#111116",
        border: "1px solid #1a1a24",
        borderRadius: 24,
        padding: "40px 48px",
        boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
      }}>
        <button
          onClick={() => router.back()}
          style={{
            background: "transparent",
            border: "1px solid #333",
            color: "#aaa",
            borderRadius: 8,
            padding: "8px 16px",
            cursor: "pointer",
            marginBottom: 32,
            fontSize: 14,
          }}
        >
          ← Back
        </button>

        <h1 style={{ color: "#fff", fontSize: 32, marginBottom: 8, fontWeight: 800 }}>Privacy Policy</h1>
        <p style={{ color: "#888", fontSize: 14, marginBottom: 40 }}>Last updated: July 24, 2026</p>

        <section style={{ marginBottom: 32 }}>
          <h2 style={{ color: "#ff4d6d", fontSize: 20, marginBottom: 16 }}>What data we collect</h2>
          <ul style={{ listStyle: "disc", paddingLeft: 20, lineHeight: 1.6 }}>
            <li>Face embedding (mathematical representation of your face, not raw photos)</li>
            <li>GPS location (only when marking attendance)</li>
            <li>Attendance records (timestamps of entry/exit)</li>
            <li>Device ID (to prevent attendance fraud)</li>
          </ul>
        </section>

        <section style={{ marginBottom: 32 }}>
          <h2 style={{ color: "#ff4d6d", fontSize: 20, marginBottom: 16 }}>Why we collect it</h2>
          <p style={{ lineHeight: 1.6 }}>
            The collected biometric and location data is used <strong>strictly</strong> for hostel attendance verification. It ensures secure, frictionless, and proxy-free attendance tracking.
          </p>
        </section>

        <section style={{ marginBottom: 32 }}>
          <h2 style={{ color: "#ff4d6d", fontSize: 20, marginBottom: 16 }}>How it&apos;s stored</h2>
          <p style={{ lineHeight: 1.6 }}>
            Your data is encrypted using AES-256-GCM and stored securely on our Neon PostgreSQL database. We do not store raw images of your face for daily attendance matching, only the encrypted mathematical embeddings.
          </p>
        </section>

        <section style={{ marginBottom: 32 }}>
          <h2 style={{ color: "#ff4d6d", fontSize: 20, marginBottom: 16 }}>Who can access it</h2>
          <p style={{ lineHeight: 1.6 }}>
            Access is restricted to the hostel warden and system administrators only. Your biometric data is <strong>never</strong> shared with third parties or advertisers.
          </p>
        </section>

        <section style={{ marginBottom: 32 }}>
          <h2 style={{ color: "#ff4d6d", fontSize: 20, marginBottom: 16 }}>Retention period</h2>
          <p style={{ lineHeight: 1.6 }}>
            Your data is retained for the duration of your enrollment plus 1 year. After this period, all biometric and location records are automatically and permanently deleted from our systems.
          </p>
        </section>

        <section style={{ marginBottom: 32 }}>
          <h2 style={{ color: "#ff4d6d", fontSize: 20, marginBottom: 16 }}>Your rights</h2>
          <p style={{ lineHeight: 1.6 }}>
            You have the right to access your stored data, request deletion, or withdraw your consent at any time (though withdrawing consent may affect your ability to stay in the hostel).
          </p>
        </section>

        <section style={{ marginBottom: 32 }}>
          <h2 style={{ color: "#ff4d6d", fontSize: 20, marginBottom: 16 }}>Compliance</h2>
          <p style={{ lineHeight: 1.6 }}>
            This system complies with the IT Rules 2011 and the Digital Personal Data Protection (DPDP) Act 2023.
          </p>
        </section>

        <section style={{ marginBottom: 32 }}>
          <h2 style={{ color: "#ff4d6d", fontSize: 20, marginBottom: 16 }}>Contact for data requests</h2>
          <p style={{ lineHeight: 1.6 }}>
            For any privacy-related queries or data deletion requests, please contact the admin at: <a href="mailto:admin@hostel.edu" style={{ color: "#ff4d6d", textDecoration: "none" }}>admin@hostel.edu</a>.
          </p>
        </section>
      </div>
    </div>
  );
}
