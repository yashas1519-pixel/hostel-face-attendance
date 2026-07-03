"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getEnrollments,
  approveEnrollment,
  rejectEnrollment,
  type Enrollment,
  ApiError,
} from "@/lib/api";
import { useToast } from "@/components/Toast";

const STATUS_OPTIONS = ["", "pending", "approved", "rejected"] as const;

export default function EnrollmentsPage() {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionId, setActionId] = useState<string | null>(null);
  const { toast } = useToast();
  const limit = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getEnrollments({ status: status || undefined, page, limit });
      setEnrollments(res.data);
      setTotal(res.total);
      setError("");
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : "Failed to load enrollments";
      setError(msg);
      toast(msg, "error");
    } finally {
      setLoading(false);
    }
  }, [status, page, toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleApprove(id: string) {
    setActionId(id);
    try {
      await approveEnrollment(id);
      toast("Enrollment approved");
      await load();
    } catch (err: unknown) {
      toast(err instanceof ApiError ? err.message : "Approve failed", "error");
    } finally {
      setActionId(null);
    }
  }

  async function handleReject(id: string) {
    setActionId(id);
    try {
      await rejectEnrollment(id);
      toast("Enrollment rejected");
      await load();
    } catch (err: unknown) {
      toast(err instanceof ApiError ? err.message : "Reject failed", "error");
    } finally {
      setActionId(null);
    }
  }

  function statusBadge(s: Enrollment["status"]) {
    const cls = { pending: "badge-warning", approved: "badge-success", rejected: "badge-error" }[s];
    return <span className={`badge ${cls}`}>{s}</span>;
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <>
      <div className="page-header">
        <h1>Enrollments</h1>
      </div>

      <div className="filters">
        <label htmlFor="filter-status" className="form-label" style={{ alignSelf: "center" }}>
          Status:
        </label>
        <select
          id="filter-status"
          className="form-select"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All</option>
          {STATUS_OPTIONS.filter(Boolean).map((s) => (
            <option key={s} value={s}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="error-state">{error}</div>}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Student</th>
              <th>Roll No</th>
              <th>Submitted</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 5 }).map((__, j) => (
                      <td key={j}>
                        <div className="skeleton skeleton-text" />
                      </td>
                    ))}
                  </tr>
                ))
              : enrollments.length === 0
                ? (
                    <tr>
                      <td colSpan={5}>
                        <div className="empty-state">No enrollments found.</div>
                      </td>
                    </tr>
                  )
                : enrollments.map((e) => (
                    <tr key={e.id}>
                      <td>{e.studentName}</td>
                      <td>{e.rollNumber}</td>
                      <td>{new Date(e.submittedAt).toLocaleDateString()}</td>
                      <td>{statusBadge(e.status)}</td>
                      <td>
                        {e.status === "pending" ? (
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              className="btn btn-primary btn-sm"
                              disabled={actionId === e.id}
                              onClick={() => handleApprove(e.id)}
                            >
                              Approve
                            </button>
                            <button
                              className="btn btn-danger btn-sm"
                              disabled={actionId === e.id}
                              onClick={() => handleReject(e.id)}
                            >
                              Reject
                            </button>
                          </div>
                        ) : (
                          <span style={{ color: "var(--text-tertiary)", fontSize: "0.8125rem" }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
          </tbody>
        </table>
      </div>

      {!loading && totalPages > 1 && (
        <div className="pagination">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ‹
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter((p) => Math.abs(p - page) <= 2 || p === 1 || p === totalPages)
            .map((p, i, arr) => {
              const prev = arr[i - 1];
              const gap = prev !== undefined && p - prev > 1;
              return (
                <span key={p}>
                  {gap && <button disabled>…</button>}
                  <button data-active={p === page} onClick={() => setPage(p)}>
                    {p}
                  </button>
                </span>
              );
            })}
          <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
            ›
          </button>
        </div>
      )}
    </>
  );
}
