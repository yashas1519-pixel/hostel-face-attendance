"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  getHostels,
  getWindows,
  createWindow,
  updateWindow,
  deleteWindow,
  type Hostel,
  type CheckInWindow,
  ApiError,
} from "@/lib/api";
import { useToast } from "@/components/Toast";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type WindowForm = {
  name: string;
  startTime: string;
  endTime: string;
  daysOfWeek: number[];
  isActive: boolean;
};

const emptyForm: WindowForm = {
  name: "",
  startTime: "22:00",
  endTime: "23:00",
  daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
  isActive: true,
};

export default function WindowsPage() {
  const [hostels, setHostels] = useState<Hostel[]>([]);
  const [hostelId, setHostelId] = useState("");
  const [windows, setWindows] = useState<CheckInWindow[]>([]);
  const [loadingHostels, setLoadingHostels] = useState(true);
  const [loadingWindows, setLoadingWindows] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<WindowForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    getHostels()
      .then((data) => {
        setHostels(data);
        if (data.length > 0) setHostelId(data[0].id);
      })
      .catch(() => toast("Failed to load hostels", "error"))
      .finally(() => setLoadingHostels(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadWindows = useCallback(async () => {
    if (!hostelId) return;
    setLoadingWindows(true);
    try {
      const data = await getWindows(hostelId);
      setWindows(data);
    } catch (err: unknown) {
      toast(err instanceof ApiError ? err.message : "Failed to load windows", "error");
    } finally {
      setLoadingWindows(false);
    }
  }, [hostelId, toast]);

  useEffect(() => { loadWindows(); }, [loadWindows]);

  function openCreate() {
    setEditId(null);
    setForm(emptyForm);
    setShowModal(true);
  }

  function openEdit(w: CheckInWindow) {
    setEditId(w.id);
    setForm({
      name: w.name,
      startTime: w.startTime,
      endTime: w.endTime,
      daysOfWeek: w.daysOfWeek,
      isActive: w.isActive,
    });
    setShowModal(true);
  }

  function toggleDay(d: number) {
    setForm((f) =>
      f.daysOfWeek.includes(d)
        ? { ...f, daysOfWeek: f.daysOfWeek.filter((x) => x !== d) }
        : { ...f, daysOfWeek: [...f.daysOfWeek, d].sort() }
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { toast("Name is required", "error"); return; }
    if (form.daysOfWeek.length === 0) { toast("Select at least one day", "error"); return; }
    if (form.startTime >= form.endTime) { toast("Start time must be before end time", "error"); return; }

    setSaving(true);
    try {
      if (editId) {
        await updateWindow(hostelId, editId, form);
        toast("Window updated");
      } else {
        await createWindow(hostelId, form);
        toast("Window created");
      }
      setShowModal(false);
      await loadWindows();
    } catch (err: unknown) {
      toast(err instanceof ApiError ? err.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteWindow(hostelId, id);
      toast("Window deleted");
      setDeleteConfirm(null);
      await loadWindows();
    } catch (err: unknown) {
      toast(err instanceof ApiError ? err.message : "Delete failed", "error");
    }
  }

  function isCurrentlyActive(w: CheckInWindow) {
    const now = new Date();
    const hh = now.getHours().toString().padStart(2, "0");
    const mm = now.getMinutes().toString().padStart(2, "0");
    const current = `${hh}:${mm}`;
    return (
      w.isActive &&
      w.daysOfWeek.includes(now.getDay()) &&
      w.startTime <= current &&
      current <= w.endTime
    );
  }

  return (
    <>
      <div className="page-header">
        <h1>Check-in Windows</h1>
        <button className="btn btn-primary" onClick={openCreate} disabled={!hostelId}>
          + Add Window
        </button>
      </div>

      <div style={{ marginBottom: 24 }}>
        <label htmlFor="hostel-select" className="form-label" style={{ marginRight: 12 }}>
          Hostel:
        </label>
        {loadingHostels ? (
          <div className="skeleton" style={{ width: 200, height: 36, display: "inline-block", borderRadius: 6 }} />
        ) : (
          <select
            id="hostel-select"
            className="form-select"
            style={{ width: "auto", minWidth: 200 }}
            value={hostelId}
            onChange={(e) => setHostelId(e.target.value)}
          >
            {hostels.length === 0 && <option value="">No hostels yet</option>}
            {hostels.map((h) => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </select>
        )}
      </div>

      {loadingWindows ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[1, 2].map((i) => <div key={i} className="card skeleton" style={{ height: 80 }} />)}
        </div>
      ) : windows.length === 0 ? (
        <div className="empty-state">
          <p>No check-in windows for this hostel. Add one to allow students to mark attendance.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {windows.map((w) => {
            const active = isCurrentlyActive(w);
            return (
              <div key={w.id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <span style={{ fontWeight: 600, fontSize: "1rem" }}>{w.name}</span>
                    {active && (
                      <span className="badge badge-success" style={{ fontSize: "0.7rem" }}>🟢 ACTIVE NOW</span>
                    )}
                    {!w.isActive && (
                      <span className="badge badge-neutral" style={{ fontSize: "0.7rem" }}>Disabled</span>
                    )}
                  </div>
                  <div style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>
                    <span style={{ marginRight: 16 }}>🕐 {w.startTime} – {w.endTime}</span>
                    <span>
                      {w.daysOfWeek.length === 7
                        ? "Every day"
                        : w.daysOfWeek.map((d) => DAYS[d]).join(", ")}
                    </span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => openEdit(w)}>Edit</button>
                  <button className="btn btn-danger btn-sm" onClick={() => setDeleteConfirm(w.id)}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editId ? "Edit Window" : "Add Check-in Window"}</h2>
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="form-group">
                <label htmlFor="win-name" className="form-label">Name</label>
                <input id="win-name" className="form-input" value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Night Check-in" required disabled={saving} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="form-group">
                  <label htmlFor="win-start" className="form-label">Start Time</label>
                  <input id="win-start" type="time" className="form-input" value={form.startTime}
                    onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                    required disabled={saving} />
                </div>
                <div className="form-group">
                  <label htmlFor="win-end" className="form-label">End Time</label>
                  <input id="win-end" type="time" className="form-input" value={form.endTime}
                    onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                    required disabled={saving} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Days of Week</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                  {DAYS.map((day, i) => (
                    <button
                      key={i}
                      type="button"
                      disabled={saving}
                      onClick={() => toggleDay(i)}
                      style={{
                        padding: "4px 12px",
                        borderRadius: 20,
                        border: "1px solid",
                        cursor: "pointer",
                        fontSize: "0.8125rem",
                        fontWeight: 500,
                        borderColor: form.daysOfWeek.includes(i) ? "#FF6B35" : "var(--border)",
                        background: form.daysOfWeek.includes(i) ? "rgba(255,107,53,0.15)" : "transparent",
                        color: form.daysOfWeek.includes(i) ? "#FF6B35" : "var(--text-secondary)",
                        transition: "all 0.15s",
                      }}
                    >
                      {day}
                    </button>
                  ))}
                </div>
              </div>
              <div className="form-group" style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <input
                  id="win-active"
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  disabled={saving}
                  style={{ width: 16, height: 16, accentColor: "#FF6B35", cursor: "pointer" }}
                />
                <label htmlFor="win-active" className="form-label" style={{ margin: 0, cursor: "pointer" }}>
                  Active (students can check-in during this window)
                </label>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)} disabled={saving}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? "Saving…" : editId ? "Update" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Delete Window</h2>
            <p className="confirm-msg">Remove this check-in window? Students won&apos;t be able to check in during this time.</p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => handleDelete(deleteConfirm)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
