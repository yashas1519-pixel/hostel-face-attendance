"use client";

import { useEffect, useState } from "react";
import { getDashboardStats, type DashboardStats, ApiError } from "@/lib/api";
import { useToast } from "@/components/Toast";

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    getDashboardStats()
      .then(setStats)
      .catch((err: unknown) => {
        const msg = err instanceof ApiError ? err.message : "Failed to load stats";
        setError(msg);
        toast(msg, "error");
      })
      .finally(() => setLoading(false));
  }, [toast]);

  const cards = [
    { label: "Total Students", key: "totalStudents" as const, accent: false },
    { label: "Boys Hostels", key: "boysHostelCount" as const, accent: false },
    { label: "Girls Hostels", key: "girlsHostelCount" as const, accent: false },
    { label: "Pending Enrollments", key: "pendingEnrollments" as const, accent: true },
    { label: "Today's Attendance", key: "todayAttendancePercent" as const, accent: true },
  ];

  return (
    <>
      <div className="page-header">
        <h1>Dashboard</h1>
      </div>

      {error && <div className="error-state">{error}</div>}

      <div className="stat-grid">
        {cards.map((c) => (
          <div key={c.key} className="card-glass stat-card">
            <div className="stat-label">{c.label}</div>
            {loading ? (
              <div className="skeleton" style={{ height: 36, width: 80 }} />
            ) : stats ? (
              <div className={`stat-value ${c.accent ? "stat-accent" : ""}`}>
                {c.key === "todayAttendancePercent"
                  ? `${stats[c.key]}%`
                  : stats[c.key]}
              </div>
            ) : (
              <div className="stat-value">—</div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
