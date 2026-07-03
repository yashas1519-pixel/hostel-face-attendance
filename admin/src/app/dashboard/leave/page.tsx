"use client";

import { useEffect, useState } from "react";
import { fetchWithAuth } from "@/lib/auth";
import { useToast } from "@/components/Toast";
import styles from "../enrollments/enrollments.module.css"; // reuse same table styles

interface LeaveRequest {
  id: string;
  studentId: string;
  fromDate: string;
  toDate: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  adminNote: string | null;
  returnedEarlyAt: string | null;
  createdAt: string;
}

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetchWithAuth(path, opts);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? res.statusText);
  return res.json() as Promise<T>;
}

const STATUS_OPTIONS = ["all", "pending", "approved", "rejected"];

export default function LeavePage() {
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("pending");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [adminNote, setAdminNote] = useState("");
  const { toast } = useToast();

  useEffect(() => { void load(); }, [status, page]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true);
    try {
      const s = status !== "all" ? `&status=${status}` : "";
      const data = await api<{ data: LeaveRequest[]; total: number }>(
        `/admin/leave?page=${page}&limit=20${s}`
      );
      setLeaves(data.data ?? []);
      setTotal(data.total ?? 0);
    } catch {
      toast("Failed to load leave requests", "error");
    } finally {
      setLoading(false);
    }
  }

  async function review(id: string, action: "approve" | "reject") {
    try {
      await api(`/admin/leave/${id}/${action}`, {
        method: "POST",
        body: JSON.stringify({ adminNote: adminNote.trim() || undefined }),
      });
      toast(`Leave ${action}d`);
      setActionId(null);
      setAdminNote("");
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed", "error");
    }
  }

  const totalPages = Math.ceil(total / 20);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 className="page-title">Leave Requests</h1>
        <span style={{ color: "#555", fontSize: 14 }}>{total} total</span>
      </div>

      {/* Status filter */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {STATUS_OPTIONS.map((s) => (
          <button
            key={s}
            onClick={() => { setStatus(s); setPage(1); }}
            style={{
              padding: "6px 16px",
              borderRadius: 20,
              border: "1px solid",
              borderColor: status === s ? "#FF6B35" : "#2a2a2a",
              background: status === s ? "rgba(255,107,53,0.12)" : "transparent",
              color: status === s ? "#FF6B35" : "#888",
              fontSize: 13,
              cursor: "pointer",
              textTransform: "capitalize",
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <div className={styles.skeleton} />
      ) : leaves.length === 0 ? (
        <div className={styles.empty}>No {status} leave requests.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {leaves.map((l) => (
            <div key={l.id} className={styles.card} style={{ padding: "18px 20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>
                    {l.fromDate} → {l.toDate}
                    <span style={{ fontWeight: 400, color: "#888", marginLeft: 10, fontSize: 12 }}>
                      ({Math.round((new Date(l.toDate).getTime() - new Date(l.fromDate).getTime()) / 86_400_000) + 1} day(s))
                    </span>
                  </p>
                  <p style={{ margin: "6px 0 0", fontSize: 13, color: "#aaa" }}>{l.reason}</p>
                  {l.adminNote && (
                    <p style={{ margin: "4px 0 0", fontSize: 12, color: "#666", fontStyle: "italic" }}>
                      Note: {l.adminNote}
                    </p>
                  )}
                  {l.returnedEarlyAt && (
                    <p style={{ margin: "4px 0 0", fontSize: 12, color: "#34d399" }}>
                      ↩ Returned early: {new Date(l.returnedEarlyAt).toLocaleDateString("en-IN")}
                    </p>
                  )}
                  <p style={{ margin: "6px 0 0", fontSize: 11, color: "#444" }}>
                    Applied {new Date(l.createdAt).toLocaleDateString("en-IN")}
                  </p>
                </div>
                <span
                  style={{
                    padding: "4px 12px",
                    borderRadius: 20,
                    fontSize: 12,
                    fontWeight: 700,
                    background:
                      l.status === "approved" ? "#052e16" :
                      l.status === "rejected" ? "#2d0808" : "#1a1a00",
                    color:
                      l.status === "approved" ? "#34d399" :
                      l.status === "rejected" ? "#ef4444" : "#fbbf24",
                  }}
                >
                  {l.status === "pending" ? "⏳ Pending" : l.status === "approved" ? "✓ Approved" : "✕ Rejected"}
                </span>
              </div>

              {/* Action panel for pending */}
              {l.status === "pending" && (
                <div style={{ marginTop: 14 }}>
                  {actionId === l.id ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <input
                        type="text"
                        placeholder="Optional note to student…"
                        value={adminNote}
                        onChange={(e) => setAdminNote(e.target.value)}
                        style={{
                          background: "#0a0a0a", border: "1px solid #2a2a2a",
                          borderRadius: 8, color: "#fff", padding: "8px 12px",
                          fontSize: 13, outline: "none",
                        }}
                      />
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          onClick={() => void review(l.id, "approve")}
                          style={{ flex: 1, padding: "8px", borderRadius: 8, border: "none", background: "#34d399", color: "#000", fontWeight: 700, cursor: "pointer", fontSize: 13 }}
                        >
                          ✓ Approve
                        </button>
                        <button
                          onClick={() => void review(l.id, "reject")}
                          style={{ flex: 1, padding: "8px", borderRadius: 8, border: "none", background: "#ef4444", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13 }}
                        >
                          ✕ Reject
                        </button>
                        <button
                          onClick={() => { setActionId(null); setAdminNote(""); }}
                          style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #333", background: "transparent", color: "#888", cursor: "pointer", fontSize: 13 }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setActionId(l.id)}
                      style={{ padding: "7px 18px", borderRadius: 8, border: "1px solid #FF6B35", background: "transparent", color: "#FF6B35", fontWeight: 600, cursor: "pointer", fontSize: 13 }}
                    >
                      Review
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 24 }}>
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="btn">← Prev</button>
          <span style={{ padding: "8px 16px", color: "#888", fontSize: 14 }}>{page} / {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="btn">Next →</button>
        </div>
      )}
    </div>
  );
}
