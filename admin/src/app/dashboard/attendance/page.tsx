"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getAttendance,
  getHostels,
  type AttendanceRecord,
  type Hostel,
  ApiError,
} from "@/lib/api";
import { useToast } from "@/components/Toast";

export default function AttendancePage() {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [hostels, setHostels] = useState<Hostel[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hostelId, setHostelId] = useState("");
  const [status, setStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { toast } = useToast();
  const limit = 20;

  useEffect(() => {
    getHostels().then(setHostels).catch(() => {
      /* hostels filter will just be empty */
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAttendance({
        hostelId: hostelId || undefined,
        status: status || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        page,
        limit,
      });
      setRecords(res.data);
      setTotal(res.total);
      setError("");
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : "Failed to load attendance";
      setError(msg);
      toast(msg, "error");
    } finally {
      setLoading(false);
    }
  }, [hostelId, status, dateFrom, dateTo, page, toast]);

  useEffect(() => {
    load();
  }, [load]);

  function statusBadge(s: AttendanceRecord["status"]) {
    const cls = { present: "badge-success", rejected: "badge-error", flagged: "badge-warning" }[s];
    return <span className={`badge ${cls}`}>{s}</span>;
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <>
      <div className="page-header">
        <h1>Attendance</h1>
      </div>

      <div className="filters">
        <div className="form-group" style={{ gap: 4 }}>
          <label htmlFor="att-hostel" className="form-label">Hostel</label>
          <select
            id="att-hostel"
            className="form-select"
            value={hostelId}
            onChange={(e) => { setHostelId(e.target.value); setPage(1); }}
          >
            <option value="">All Hostels</option>
            {hostels.map((h) => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </select>
        </div>
        <div className="form-group" style={{ gap: 4 }}>
          <label htmlFor="att-status" className="form-label">Status</label>
          <select
            id="att-status"
            className="form-select"
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          >
            <option value="">All</option>
            <option value="present">Present</option>
            <option value="rejected">Rejected</option>
            <option value="flagged">Flagged</option>
          </select>
        </div>
        <div className="form-group" style={{ gap: 4 }}>
          <label htmlFor="att-from" className="form-label">From</label>
          <input
            id="att-from"
            type="date"
            className="form-input"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
          />
        </div>
        <div className="form-group" style={{ gap: 4 }}>
          <label htmlFor="att-to" className="form-label">To</label>
          <input
            id="att-to"
            type="date"
            className="form-input"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
          />
        </div>
      </div>

      {error && <div className="error-state">{error}</div>}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Student</th>
              <th>Hostel</th>
              <th>Time</th>
              <th>Face Score</th>
              <th>Liveness</th>
              <th>Location</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((__, j) => (
                      <td key={j}>
                        <div className="skeleton skeleton-text" />
                      </td>
                    ))}
                  </tr>
                ))
              : records.length === 0
                ? (
                    <tr>
                      <td colSpan={7}>
                        <div className="empty-state">No attendance records found.</div>
                      </td>
                    </tr>
                  )
                : records.map((r) => (
                    <tr
                      key={r.id}
                      className={r.status === "flagged" ? "table-row-flagged" : ""}
                    >
                      <td>{r.studentName}</td>
                      <td>{r.hostelName}</td>
                      <td>{new Date(r.time).toLocaleString()}</td>
                      <td>{(r.faceScore * 100).toFixed(1)}%</td>
                      <td>{(r.livenessScore * 100).toFixed(1)}%</td>
                      <td>
                        <span className={`badge ${r.locationVerified ? "badge-success" : "badge-error"}`}>
                          {r.locationVerified ? "Verified" : "Failed"}
                        </span>
                      </td>
                      <td>{statusBadge(r.status)}</td>
                    </tr>
                  ))}
          </tbody>
        </table>
      </div>

      {!loading && totalPages > 1 && (
        <div className="pagination">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</button>
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter((p) => Math.abs(p - page) <= 2 || p === 1 || p === totalPages)
            .map((p, i, arr) => {
              const prev = arr[i - 1];
              const gap = prev !== undefined && p - prev > 1;
              return (
                <span key={p}>
                  {gap && <button disabled>…</button>}
                  <button data-active={p === page} onClick={() => setPage(p)}>{p}</button>
                </span>
              );
            })}
          <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}>›</button>
        </div>
      )}
    </>
  );
}
