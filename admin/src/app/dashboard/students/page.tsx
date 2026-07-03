"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getStudents,
  getHostels,
  assignStudentHostel,
  type Student,
  type Hostel,
  ApiError,
} from "@/lib/api";
import { useToast } from "@/components/Toast";

export default function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [hostels, setHostels] = useState<Hostel[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hostelFilter, setHostelFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const { toast } = useToast();
  const limit = 20;

  useEffect(() => {
    getHostels().then(setHostels).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getStudents({
        hostelId: hostelFilter || undefined,
        page,
        limit,
      });
      setStudents(res.data);
      setTotal(res.total);
      setError("");
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : "Failed to load students";
      setError(msg);
      toast(msg, "error");
    } finally {
      setLoading(false);
    }
  }, [hostelFilter, page, toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAssign(studentId: string, hostelId: string) {
    setAssigningId(studentId);
    try {
      await assignStudentHostel(studentId, hostelId || null);
      toast("Hostel assignment updated");
      await load();
    } catch (err: unknown) {
      toast(err instanceof ApiError ? err.message : "Assign failed", "error");
    } finally {
      setAssigningId(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <>
      <div className="page-header">
        <h1>Students</h1>
      </div>

      <div className="filters">
        <label htmlFor="stu-hostel" className="form-label" style={{ alignSelf: "center" }}>
          Hostel:
        </label>
        <select
          id="stu-hostel"
          className="form-select"
          value={hostelFilter}
          onChange={(e) => { setHostelFilter(e.target.value); setPage(1); }}
        >
          <option value="">All</option>
          {hostels.map((h) => (
            <option key={h.id} value={h.id}>{h.name}</option>
          ))}
        </select>
      </div>

      {error && <div className="error-state">{error}</div>}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Roll No</th>
              <th>Email</th>
              <th>Hostel</th>
              <th>Assign</th>
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
              : students.length === 0
                ? (
                    <tr>
                      <td colSpan={5}>
                        <div className="empty-state">No students found.</div>
                      </td>
                    </tr>
                  )
                : students.map((s) => (
                    <tr key={s.id}>
                      <td>{s.name}</td>
                      <td>{s.rollNumber}</td>
                      <td style={{ color: "var(--text-secondary)" }}>{s.email}</td>
                      <td>
                        {s.hostelName ? (
                          <span className="badge badge-info">{s.hostelName}</span>
                        ) : (
                          <span className="badge badge-neutral">Unassigned</span>
                        )}
                      </td>
                      <td>
                        <label htmlFor={`assign-${s.id}`} className="sr-only">
                          Assign hostel for {s.name}
                        </label>
                        <select
                          id={`assign-${s.id}`}
                          className="form-select"
                          value={s.hostelId || ""}
                          onChange={(e) => handleAssign(s.id, e.target.value)}
                          disabled={assigningId === s.id}
                          style={{ minWidth: 140 }}
                        >
                          <option value="">None</option>
                          {hostels.map((h) => (
                            <option key={h.id} value={h.id}>{h.name}</option>
                          ))}
                        </select>
                      </td>
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
