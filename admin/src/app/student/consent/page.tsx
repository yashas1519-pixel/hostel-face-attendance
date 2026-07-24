"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function ConsentPage() {
  const router = useRouter();
  const [check1, setCheck1] = useState(false);
  const [check2, setCheck2] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

  useEffect(() => {
    // Check if already consented
    const checkConsent = async () => {
      try {
        const res = await fetch(`${API}/consent/status`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token') ?? ''}` },
        });
        if (res.ok) {
          const data = await res.json() as { consented: boolean };
          if (data.consented) {
            router.push('/student/enroll');
          }
        }
      } catch (err) {
        // ignore
      }
    };
    void checkConsent();
  }, [API, router]);

  const handleSubmit = async () => {
    if (!check1 || !check2) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/consent/record`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem('token') ?? ''}` 
        },
        body: JSON.stringify({ consented: true })
      });
      
      if (res.ok) {
        router.push('/student/enroll');
      } else {
        const data = await res.json().catch(() => ({}));
        setError((data as { message?: string }).message ?? "Failed to record consent. Please try again.");
        setLoading(false);
      }
    } catch (err) {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0a0f",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 20,
      fontFamily: "'Inter', -apple-system, sans-serif",
    }}>
      <div style={{
        width: "100%",
        maxWidth: 500,
        background: "rgba(17, 17, 22, 0.7)",
        backdropFilter: "blur(20px)",
        border: "1px solid rgba(255, 77, 109, 0.2)",
        borderRadius: 24,
        padding: 40,
        boxShadow: "0 24px 60px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)",
      }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ 
            width: 64, height: 64, 
            background: "linear-gradient(135deg, rgba(255, 77, 109, 0.2), rgba(255, 138, 90, 0.1))",
            borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 20px", border: "1px solid rgba(255, 77, 109, 0.3)"
          }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ff4d6d" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          </div>
          <h1 style={{ color: "#fff", fontSize: 24, fontWeight: 700, margin: "0 0 8px" }}>Data Consent</h1>
          <p style={{ color: "#888", fontSize: 14, margin: 0 }}>
            Before you enroll your face, we need your consent to collect and store biometric data.
          </p>
        </div>

        {error && (
          <div style={{ 
            background: "rgba(255,77,109,0.1)", border: "1px solid #ff4d6d", 
            color: "#ff4d6d", padding: "12px 16px", borderRadius: 12, 
            fontSize: 14, marginBottom: 24, textAlign: "center" 
          }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 32 }}>
          <label style={{ 
            display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer",
            background: "rgba(255,255,255,0.03)", padding: 16, borderRadius: 16,
            border: `1px solid ${check1 ? "#ff4d6d" : "rgba(255,255,255,0.1)"}`,
            transition: "all 0.2s ease"
          }}>
            <input 
              type="checkbox" 
              checked={check1} 
              onChange={(e) => setCheck1(e.target.checked)}
              style={{ marginTop: 4, accentColor: "#ff4d6d", width: 18, height: 18, cursor: "pointer" }}
            />
            <span style={{ color: "#ddd", fontSize: 14, lineHeight: 1.5 }}>
              I understand my face biometric data will be collected and stored for hostel attendance.
            </span>
          </label>

          <label style={{ 
            display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer",
            background: "rgba(255,255,255,0.03)", padding: 16, borderRadius: 16,
            border: `1px solid ${check2 ? "#ff4d6d" : "rgba(255,255,255,0.1)"}`,
            transition: "all 0.2s ease"
          }}>
            <input 
              type="checkbox" 
              checked={check2} 
              onChange={(e) => setCheck2(e.target.checked)}
              style={{ marginTop: 4, accentColor: "#ff4d6d", width: 18, height: 18, cursor: "pointer" }}
            />
            <span style={{ color: "#ddd", fontSize: 14, lineHeight: 1.5 }}>
              I have read the <Link href="/privacy" target="_blank" style={{ color: "#ff4d6d", textDecoration: "none" }}>Privacy Policy</Link> and consent to data collection.
            </span>
          </label>
        </div>

        <button
          onClick={handleSubmit}
          disabled={!check1 || !check2 || loading}
          style={{
            width: "100%",
            background: (!check1 || !check2) ? "#222" : "linear-gradient(135deg, #ff4d6d, #ff8a5a)",
            color: (!check1 || !check2) ? "#666" : "#fff",
            border: "none",
            borderRadius: 14,
            padding: "16px",
            fontSize: 16,
            fontWeight: 600,
            cursor: (!check1 || !check2 || loading) ? "not-allowed" : "pointer",
            transition: "all 0.3s ease",
            boxShadow: (!check1 || !check2) ? "none" : "0 8px 24px rgba(255, 77, 109, 0.3)",
          }}
        >
          {loading ? "Processing..." : "I Consent — Proceed to Enrollment"}
        </button>
      </div>
    </div>
  );
}
