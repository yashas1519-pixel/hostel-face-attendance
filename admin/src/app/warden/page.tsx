"use client";

import { useEffect, useState, useCallback } from "react";
import { fetchWithAuth, logout } from "@/lib/auth";
import { useToast } from "@/components/Toast";

interface Failure {
  id: string;
  studentId: string;
  studentName: string;
  rollNumber: string | null;
  facePhoto: string | null;
  failedAt: string;
  resolved: boolean;
}

interface HostelInfo { id: string; name: string; type: string; }

export default function WardenPage() {
  const [hostel, setHostel] = useState<HostelInfo | null>(null);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [hostelRes, failRes] = await Promise.all([
        fetchWithAuth("/warden/my-hostel"),
        fetchWithAuth("/warden/failures"),
      ]);
      if (hostelRes.ok) setHostel(await hostelRes.json() as HostelInfo);
      if (failRes.ok) {
        const data = await failRes.json() as { hostelId: string; failures: Failure[] };
        setFailures(data.failures ?? []);
      }
    } catch { toast("Failed to load", "error"); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  async function markPresent(failure: Failure) {
    if (!hostel) return;
    setActionId(failure.id);
    try {
      const r = await fetchWithAuth("/warden/attendance/manual", {
        method: "POST",
        body: JSON.stringify({ studentId: failure.studentId, hostelId: hostel.id }),
      });
      if (!r.ok) { const b = await r.json().catch(() => ({})) as { message?: string }; throw new Error(b.message ?? "Failed"); }
      toast(`${failure.studentName} marked Present`);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed", "error");
    } finally { setActionId(null); }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", fontFamily: "Inter, sans-serif", color: "#fff" }}>
      {/* Header */}
      <header style={{ borderBottom: "1px solid #1a1a1a", padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 24 }}>🛡️</span>
          <div>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Warden Dashboard</h1>
            {hostel && <p style={{ margin: 0, fontSize: 12, color: "#555" }}>{hostel.name}</p>}
          </div>
        </div>
        <button onClick={logout} style={{ background: "none", border: "1px solid #333", borderRadius: 8, color: "#888", padding: "6px 14px", cursor: "pointer", fontSize: 13 }}>Sign out</button>
      </header>

      <div style={{ maxWidth: 700, margin: "0 auto", padding: "32px 20px" }}>
        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 32 }}>
          <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 14, padding: "20px 24px" }}>
            <p style={{ margin: "0 0 4px", color: "#555", fontSize: 12, textTransform: "uppercase", letterSpacing: 1 }}>Pending Failures</p>
            <p style={{ margin: 0, fontSize: 36, fontWeight: 800, color: "#f87171" }}>{loading ? "—" : failures.length}</p>
          </div>
          <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 14, padding: "20px 24px" }}>
            <p style={{ margin: "0 0 4px", color: "#555", fontSize: 12, textTransform: "uppercase", letterSpacing: 1 }}>Hostel</p>
            <p style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#fff" }}>{hostel?.name ?? "—"}</p>
          </div>
        </div>

        <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 16px", color: "#ccc" }}>
          Liveness Failures — Require Manual Attendance
        </h2>

        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} style={{ background: "#111", borderRadius: 12, height: 80, marginBottom: 12, animation: "pulse 1.5s infinite" }} />
          ))
        ) : failures.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "#444" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
            <p style={{ fontWeight: 600 }}>No pending failures</p>
            <p style={{ fontSize: 13 }}>All students have successfully marked attendance.</p>
          </div>
        ) : (
          failures.map((f) => (
            <div key={f.id} style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 14, padding: "16px 20px", marginBottom: 12, display: "flex", alignItems: "center", gap: 16 }}>
              {/* Face photo */}
              <div style={{ width: 52, height: 52, borderRadius: "50%", overflow: "hidden", background: "#1a1a1a", flexShrink: 0, border: "2px solid #2a2a2a", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {f.facePhoto
                  ? <img src={f.facePhoto} alt={f.studentName} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  : <span style={{ fontSize: 22 }}>👤</span>}
              </div>
              {/* Info */}
              <div style={{ flex: 1 }}>
                <p style={{ margin: "0 0 2px", fontWeight: 700, fontSize: 15 }}>{f.studentName}</p>
                <p style={{ margin: "0 0 4px", color: "#555", fontSize: 12 }}>{f.rollNumber ?? "No roll number"}</p>
                <p style={{ margin: 0, color: "#f87171", fontSize: 11 }}>
                  Failed at {new Date(f.failedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} · 3 liveness attempts
                </p>
              </div>
              {/* Action */}
              <button
                disabled={actionId === f.id}
                onClick={() => void markPresent(f)}
                style={{
                  padding: "10px 18px", background: actionId === f.id ? "#1a2a1a" : "linear-gradient(135deg,#34D399,#059669)",
                  border: "none", borderRadius: 10, color: "#fff", fontWeight: 700, fontSize: 13,
                  cursor: actionId === f.id ? "not-allowed" : "pointer", whiteSpace: "nowrap",
                }}
              >
                {actionId === f.id ? "Marking…" : "✓ Mark Present"}
              </button>
            </div>
          ))
        )}
      </div>

      <style>{`@keyframes pulse { 0%,100%{opacity:0.4} 50%{opacity:0.8} }`}</style>
    </div>
  );
}
