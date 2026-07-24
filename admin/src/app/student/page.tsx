"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fetchWithAuth } from "@/lib/auth";
import { logout } from "@/lib/auth";
import { useToast } from "@/components/Toast";
import styles from "./student.module.css";

interface UserProfile {
  id: string;
  name: string;
  email: string;
  rollNumber: string | null;
  enrollmentStatus: string;
  hostelId: string | null;
}

interface AttendanceRecord {
  id: string;
  markedAt: string;
  status: "present" | "rejected" | "flagged";
  rejectionReason: string | null;
  faceMatchScore: number;
}

interface LeaveRequest {
  id: string;
  fromDate: string;
  toDate: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  adminNote: string | null;
  returnedEarlyAt: string | null;
  createdAt: string;
}

type Tab = "attendance" | "leave";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetchWithAuth(path, opts);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export default function StudentPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("attendance");
  const [user, setUser] = useState<UserProfile | null>(null);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  // Leave form state
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [me, att, lv] = await Promise.all([
        apiFetch<UserProfile>("/auth/me"),
        apiFetch<{ data: AttendanceRecord[] }>("/attendance/history?page=1&limit=30"),
        apiFetch<{ data: LeaveRequest[] }>("/leave/my-requests?page=1&limit=30"),
      ]);
      setUser(me);
      setAttendance(att.data ?? []);
      setLeaves(lv.data ?? []);

      // First-time login: redirect to face enrollment if not yet enrolled
      if (me.enrollmentStatus === "none" || me.enrollmentStatus === "rejected") {
        router.push("/student/enroll");
        return;
      }
    } catch {
      toast("Failed to load data", "error");
    } finally {
      setLoading(false);
    }
  }

  async function applyLeave(e: FormEvent) {
    e.preventDefault();
    if (!fromDate || !toDate || !reason.trim()) return;
    if (fromDate > toDate) { toast("Start date must be before end date", "error"); return; }
    setSubmitting(true);
    try {
      await fetchWithAuth("/leave/request", {
        method: "POST",
        body: JSON.stringify({ fromDate, toDate, reason }),
      });
      toast("Leave applied successfully!");
      setFromDate(""); setToDate(""); setReason("");
      void loadAll();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to apply leave", "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function markEarlyReturn(id: string) {
    try {
      await fetchWithAuth(`/leave/${id}/early-return`, { method: "PATCH", body: "{}" });
      toast("Early return marked!");
      void loadAll();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed", "error");
    }
  }

  const presentCount = attendance.filter((a) => a.status === "present").length;
  const totalCount = attendance.length;

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.skeleton} />
        <div className={styles.skeleton} style={{ height: 120 }} />
        <div className={styles.skeleton} />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.logo}>🏠</span>
          <div>
            <h1 className={styles.name}>{user?.name ?? "Student"}</h1>
            <p className={styles.roll}>{user?.rollNumber ?? user?.email}</p>
          </div>
        </div>
        <button className={styles.logoutBtn} onClick={logout}>Sign out</button>
      </header>

      {/* Enrollment status banner */}
      {user?.enrollmentStatus === "pending" && (
        <div style={{
          background: "rgba(251,191,36,0.08)",
          border: "1px solid rgba(251,191,36,0.3)",
          borderRadius: 14,
          padding: "14px 20px",
          marginBottom: 20,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}>
          <span style={{ fontSize: 20 }}>⏳</span>
          <div>
            <p style={{ margin: 0, color: "#fbbf24", fontWeight: 600, fontSize: 14 }}>
              Face enrollment pending admin approval
            </p>
            <p style={{ margin: 0, color: "#78716c", fontSize: 12, marginTop: 2 }}>
              You can browse your dashboard, but attendance marking via mobile app requires approval.
            </p>
          </div>
        </div>
      )}

      {/* Status cards */}
      <div className={styles.cards}>
        <div className={styles.card}>
          <span className={styles.cardNum}>{presentCount}</span>
          <span className={styles.cardLabel}>Days Present</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardNum}>{totalCount}</span>
          <span className={styles.cardLabel}>Total Records</span>
        </div>
        <div className={styles.card}>
          <span
            className={styles.cardNum}
            style={{ color: user?.enrollmentStatus === "approved" ? "#34D399" : "#FF6B35" }}
          >
            {user?.enrollmentStatus ?? "—"}
          </span>
          <span className={styles.cardLabel}>Face Enrollment</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardNum} style={{ color: "#FF6B35" }}>
            {leaves.filter((l) => l.status === "pending").length}
          </span>
          <span className={styles.cardLabel}>Pending Leaves</span>
        </div>
      </div>

      {/* Tabs */}
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${tab === "attendance" ? styles.tabActive : ""}`}
          onClick={() => setTab("attendance")}
        >
          📋 Attendance
        </button>
        <button
          className={`${styles.tab} ${tab === "leave" ? styles.tabActive : ""}`}
          onClick={() => setTab("leave")}
        >
          🗓 Leave
        </button>
      </div>

      {/* Attendance tab */}
      {tab === "attendance" && (
        <div className={styles.section}>
          {/* Mark attendance CTA */}
          {user?.enrollmentStatus === "approved" && (
            <Link
              href="/student/mark-attendance"
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                background: "linear-gradient(135deg,#FF6B35,#e8502a)",
                color: "#fff", borderRadius: 14, padding: "16px 28px",
                fontWeight: 700, fontSize: 16, textDecoration: "none",
                marginBottom: 24, boxShadow: "0 4px 20px rgba(255,107,53,0.35)",
                transition: "transform 0.2s",
              }}
            >
              <span style={{ fontSize: 22 }}>👁</span>
              Mark Attendance with Face
            </Link>
          )}
          {attendance.length === 0 ? (
            <div className={styles.empty}>No attendance records yet.</div>
          ) : (
            <div className={styles.list}>
              {attendance.map((a) => (
                <div key={a.id} className={styles.row}>
                  <div className={styles.rowLeft}>
                    <span
                      className={styles.badge}
                      data-status={a.status}
                    >
                      {a.status === "present" ? "✓ Present" : a.status === "flagged" ? "⚑ Flagged" : "✕ Rejected"}
                    </span>
                    <span className={styles.rowDate}>
                      {new Date(a.markedAt).toLocaleString("en-IN", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                  </div>
                  <span className={styles.rowScore}>
                    {(a.faceMatchScore * 100).toFixed(0)}% match
                  </span>
                  {a.rejectionReason && (
                    <span className={styles.rowReason}>{a.rejectionReason}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Leave tab */}
      {tab === "leave" && (
        <div className={styles.section}>
          {/* Apply form */}
          <div className={styles.leaveCard}>
            <h2 className={styles.leaveTitle}>Apply for Leave</h2>
            <form className={styles.leaveForm} onSubmit={applyLeave}>
              <div className={styles.dateRow}>
                <div className={styles.field}>
                  <label htmlFor="fromDate" className={styles.label}>From</label>
                  <input
                    id="fromDate"
                    type="date"
                    className={styles.input}
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    min={new Date().toISOString().split("T")[0]}
                    required
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor="toDate" className={styles.label}>To</label>
                  <input
                    id="toDate"
                    type="date"
                    className={styles.input}
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    min={fromDate || new Date().toISOString().split("T")[0]}
                    required
                  />
                </div>
              </div>
              {fromDate && toDate && fromDate <= toDate && (
                <p className={styles.daysNote}>
                  {Math.round((new Date(toDate).getTime() - new Date(fromDate).getTime()) / 86_400_000) + 1} day(s)
                </p>
              )}
              <div className={styles.field}>
                <label htmlFor="reason" className={styles.label}>Reason</label>
                <textarea
                  id="reason"
                  className={styles.textarea}
                  placeholder="Describe your reason for leave…"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  maxLength={500}
                  required
                />
                <span className={styles.charCount}>{reason.length}/500</span>
              </div>
              <button type="submit" className={styles.applyBtn} disabled={submitting}>
                {submitting ? "Submitting…" : "Apply for Leave"}
              </button>
            </form>
          </div>

          {/* Leave history */}
          <h2 className={styles.leaveTitle} style={{ marginTop: 24 }}>My Leave Requests</h2>
          {leaves.length === 0 ? (
            <div className={styles.empty}>No leave requests yet.</div>
          ) : (
            <div className={styles.list}>
              {leaves.map((l) => (
                <div key={l.id} className={styles.leaveRow}>
                  <div className={styles.leaveRowTop}>
                    <span className={styles.leaveDate}>
                      {l.fromDate} → {l.toDate}
                    </span>
                    <span className={styles.badge} data-status={l.status}>
                      {l.status === "pending" ? "⏳ Pending" : l.status === "approved" ? "✓ Approved" : "✕ Rejected"}
                    </span>
                  </div>
                  <p className={styles.leaveReason}>{l.reason}</p>
                  {l.adminNote && (
                    <p className={styles.adminNote}>Admin: {l.adminNote}</p>
                  )}
                  {l.status === "approved" && !l.returnedEarlyAt && (
                    <button
                      className={styles.earlyBtn}
                      onClick={() => void markEarlyReturn(l.id)}
                    >
                      🏠 I returned early
                    </button>
                  )}
                  {l.returnedEarlyAt && (
                    <p className={styles.earlyNote}>
                      ↩ Returned early on {new Date(l.returnedEarlyAt).toLocaleDateString("en-IN")}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
