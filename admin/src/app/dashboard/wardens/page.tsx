"use client";

import { useEffect, useState, useCallback } from "react";
import { fetchWithAuth } from "@/lib/auth";
import { useToast } from "@/components/Toast";

interface Hostel { id: string; name: string; }
interface Warden { id: string; wardenId: string; wardenName: string; wardenEmail: string; assignedAt: string; }
interface AllWarden { id: string; name: string; email: string; }

export default function WardenManagePage() {
  const [hostels, setHostels] = useState<Hostel[]>([]);
  const [selectedHostel, setSelectedHostel] = useState<string>("");
  const [wardens, setWardens] = useState<Warden[]>([]);
  const [allWardens, setAllWardens] = useState<AllWarden[]>([]);
  const [loading, setLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [selectedWarden, setSelectedWarden] = useState<string>("");
  const { toast } = useToast();

  // Load hostels and all warden users
  useEffect(() => {
    void (async () => {
      const [hRes, wRes] = await Promise.all([
        fetchWithAuth("/hostel?page=1&limit=100"),
        fetchWithAuth("/admin/wardens"),
      ]);
      if (hRes.ok) { const d = await hRes.json() as { data: Hostel[] }; setHostels(d.data ?? []); }
      if (wRes.ok) { setAllWardens(await wRes.json() as AllWarden[]); }
    })();
  }, []);

  const loadWardens = useCallback(async (hostelId: string) => {
    setLoading(true);
    const r = await fetchWithAuth(`/admin/hostel/${hostelId}/wardens`);
    if (r.ok) setWardens(await r.json() as Warden[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (selectedHostel) void loadWardens(selectedHostel);
    else setWardens([]);
  }, [selectedHostel, loadWardens]);

  async function assign() {
    if (!selectedHostel || !selectedWarden) return;
    setAssigning(true);
    try {
      const r = await fetchWithAuth(`/admin/hostel/${selectedHostel}/wardens`, {
        method: "POST",
        body: JSON.stringify({ wardenId: selectedWarden }),
      });
      if (!r.ok) { const b = await r.json().catch(() => ({})) as { message?: string }; throw new Error(b.message ?? "Failed"); }
      toast("Warden assigned successfully");
      setSelectedWarden("");
      await loadWardens(selectedHostel);
    } catch (e) { toast(e instanceof Error ? e.message : "Failed", "error"); }
    finally { setAssigning(false); }
  }

  async function remove(wardenId: string, name: string) {
    if (!selectedHostel) return;
    if (!confirm(`Remove ${name} as warden?`)) return;
    const r = await fetchWithAuth(`/admin/hostel/${selectedHostel}/wardens/${wardenId}`, { method: "DELETE" });
    if (r.ok) { toast("Warden removed"); await loadWardens(selectedHostel); }
    else toast("Failed to remove", "error");
  }

  // Already-assigned warden IDs for this hostel
  const assignedIds = new Set(wardens.map((w) => w.wardenId));
  const available = allWardens.filter((w) => !assignedIds.has(w.id));

  return (
    <div style={{ padding: "32px 24px", maxWidth: 720 }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, margin: "0 0 4px", color: "#fff" }}>Warden Management</h1>
      <p style={{ color: "#555", fontSize: 14, margin: "0 0 32px" }}>
        Assign wardens to hostels. Wardens can manually mark attendance for students who fail liveness checks.
      </p>

      {/* Hostel selector */}
      <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 14, padding: "20px 24px", marginBottom: 24 }}>
        <label style={{ display: "block", fontSize: 12, color: "#555", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
          Select Hostel
        </label>
        <select
          value={selectedHostel}
          onChange={(e) => setSelectedHostel(e.target.value)}
          style={{ width: "100%", background: "#0a0a0a", border: "1px solid #2a2a2a", borderRadius: 8, padding: "10px 12px", color: "#fff", fontSize: 14 }}
        >
          <option value="">— Choose a hostel —</option>
          {hostels.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
      </div>

      {selectedHostel && (
        <>
          {/* Assign warden */}
          <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 14, padding: "20px 24px", marginBottom: 24 }}>
            <h2 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600, color: "#ccc" }}>Assign New Warden</h2>
            {allWardens.length === 0 ? (
              <p style={{ color: "#f87171", fontSize: 13 }}>
                No warden accounts found. Register a user with role <code style={{ background: "#1a1a1a", padding: "2px 6px", borderRadius: 4 }}>warden</code> first.
              </p>
            ) : available.length === 0 ? (
              <p style={{ color: "#555", fontSize: 13 }}>All warden accounts are already assigned to this hostel.</p>
            ) : (
              <div style={{ display: "flex", gap: 10 }}>
                <select
                  value={selectedWarden}
                  onChange={(e) => setSelectedWarden(e.target.value)}
                  style={{ flex: 1, background: "#0a0a0a", border: "1px solid #2a2a2a", borderRadius: 8, padding: "10px 12px", color: "#fff", fontSize: 14 }}
                >
                  <option value="">— Select warden —</option>
                  {available.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.email})</option>)}
                </select>
                <button
                  onClick={() => void assign()}
                  disabled={!selectedWarden || assigning}
                  style={{ padding: "10px 20px", background: assigning ? "#1a1a1a" : "#FF6B35", border: "none", borderRadius: 8, color: "#fff", fontWeight: 700, fontSize: 14, cursor: assigning ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}
                >
                  {assigning ? "Assigning…" : "+ Assign"}
                </button>
              </div>
            )}
          </div>

          {/* Current wardens */}
          <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 14, padding: "20px 24px" }}>
            <h2 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600, color: "#ccc" }}>
              Current Wardens {!loading && <span style={{ color: "#555", fontSize: 13, fontWeight: 400 }}>({wardens.length})</span>}
            </h2>
            {loading ? (
              <div style={{ height: 60, background: "#1a1a1a", borderRadius: 8, animation: "pulse 1.5s infinite" }} />
            ) : wardens.length === 0 ? (
              <p style={{ color: "#555", fontSize: 13 }}>No wardens assigned to this hostel yet.</p>
            ) : (
              wardens.map((w) => (
                <div key={w.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 0", borderBottom: "1px solid #1a1a1a" }}>
                  <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#1a2a3a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🛡️</div>
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: "0 0 2px", fontWeight: 600, fontSize: 14, color: "#fff" }}>{w.wardenName}</p>
                    <p style={{ margin: 0, color: "#555", fontSize: 12 }}>{w.wardenEmail}</p>
                  </div>
                  <p style={{ color: "#333", fontSize: 11, margin: 0 }}>
                    Since {new Date(w.assignedAt).toLocaleDateString("en-IN")}
                  </p>
                  <button
                    onClick={() => void remove(w.wardenId, w.wardenName)}
                    style={{ padding: "6px 14px", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 8, color: "#f87171", fontSize: 12, cursor: "pointer" }}
                  >
                    Remove
                  </button>
                </div>
              ))
            )}
          </div>
        </>
      )}
      <style>{`@keyframes pulse { 0%,100%{opacity:0.4} 50%{opacity:0.8} }`}</style>
    </div>
  );
}
