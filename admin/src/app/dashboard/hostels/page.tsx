"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  getHostels,
  createHostel,
  updateHostel,
  deleteHostel,
  type Hostel,
  ApiError,
} from "@/lib/api";
import { useToast } from "@/components/Toast";

type HostelForm = {
  name: string;
  type: "boys" | "girls";
  wifiBssids: string;
  geofenceLat: string;
  geofenceLng: string;
};

const emptyForm: HostelForm = {
  name: "",
  type: "boys",
  wifiBssids: "",
  geofenceLat: "",
  geofenceLng: "",
};

export default function HostelsPage() {
  const [hostels, setHostels] = useState<Hostel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<HostelForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const { toast } = useToast();

  async function load() {
    try {
      const data = await getHostels();
      setHostels(data);
      setError("");
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : "Failed to load hostels";
      setError(msg);
      toast(msg, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openCreate() {
    setEditId(null);
    setForm(emptyForm);
    setShowModal(true);
  }

  function openEdit(h: Hostel) {
    setEditId(h.id);
    setForm({
      name: h.name,
      type: h.type,
      wifiBssids: h.wifiBssids.join(", "),
      geofenceLat: h.geofence.map((p) => p.lat).join(", "),
      geofenceLng: h.geofence.map((p) => p.lng).join(", "),
    });
    setShowModal(true);
  }

  function parseCoords(latStr: string, lngStr: string) {
    const lats = latStr.split(",").map((s) => parseFloat(s.trim())).filter((n) => !isNaN(n));
    const lngs = lngStr.split(",").map((s) => parseFloat(s.trim())).filter((n) => !isNaN(n));
    const len = Math.min(lats.length, lngs.length);
    return Array.from({ length: len }, (_, i) => ({ lat: lats[i], lng: lngs[i] }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast("Hostel name is required", "error");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        type: form.type,
        wifiBssids: form.wifiBssids
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        geofence: parseCoords(form.geofenceLat, form.geofenceLng),
      };
      if (editId) {
        await updateHostel(editId, payload);
        toast("Hostel updated");
      } else {
        await createHostel(payload);
        toast("Hostel created");
      }
      setShowModal(false);
      await load();
    } catch (err: unknown) {
      toast(err instanceof ApiError ? err.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteHostel(id);
      toast("Hostel deleted");
      setDeleteConfirm(null);
      await load();
    } catch (err: unknown) {
      toast(err instanceof ApiError ? err.message : "Delete failed", "error");
    }
  }

  return (
    <>
      <div className="page-header">
        <h1>Hostels</h1>
        <button className="btn btn-primary" onClick={openCreate}>
          + Create Hostel
        </button>
      </div>

      {error && <div className="error-state">{error}</div>}

      {loading ? (
        <div className="stat-grid">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card skeleton skeleton-card" />
          ))}
        </div>
      ) : hostels.length === 0 ? (
        <div className="empty-state">
          <p>No hostels yet. Create your first hostel to get started.</p>
        </div>
      ) : (
        <div className="stat-grid">
          {hostels.map((h) => (
            <div key={h.id} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <h3>{h.name}</h3>
                <span className={`badge ${h.type === "boys" ? "badge-info" : "badge-accent"}`}>
                  {h.type}
                </span>
              </div>
              <p style={{ fontSize: "0.875rem", marginBottom: 16 }}>
                {h.studentCount} student{h.studentCount !== 1 ? "s" : ""} •{" "}
                {h.wifiBssids.length} BSSID{h.wifiBssids.length !== 1 ? "s" : ""}
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => openEdit(h)}>
                  Edit
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => setDeleteConfirm(h.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editId ? "Edit Hostel" : "Create Hostel"}</h2>
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="form-group">
                <label htmlFor="hostel-name" className="form-label">Name</label>
                <input
                  id="hostel-name"
                  className="form-input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Hostel A"
                  required
                  disabled={saving}
                />
              </div>
              <div className="form-group">
                <label htmlFor="hostel-type" className="form-label">Type</label>
                <select
                  id="hostel-type"
                  className="form-select"
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as "boys" | "girls" })}
                  disabled={saving}
                >
                  <option value="boys">Boys</option>
                  <option value="girls">Girls</option>
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="hostel-bssids" className="form-label">
                  WiFi BSSIDs (comma-separated)
                </label>
                <input
                  id="hostel-bssids"
                  className="form-input"
                  value={form.wifiBssids}
                  onChange={(e) => setForm({ ...form, wifiBssids: e.target.value })}
                  placeholder="AA:BB:CC:DD:EE:FF, 11:22:33:44:55:66"
                  disabled={saving}
                />
              </div>
              <div className="form-group">
                {/* ponytail: simple coordinate inputs, skip map widget for MVP */}
                <label htmlFor="hostel-lat" className="form-label">
                  Geofence Latitudes (comma-separated)
                </label>
                <input
                  id="hostel-lat"
                  className="form-input"
                  value={form.geofenceLat}
                  onChange={(e) => setForm({ ...form, geofenceLat: e.target.value })}
                  placeholder="28.6139, 28.6140, 28.6141"
                  disabled={saving}
                />
              </div>
              <div className="form-group">
                <label htmlFor="hostel-lng" className="form-label">
                  Geofence Longitudes (comma-separated)
                </label>
                <input
                  id="hostel-lng"
                  className="form-input"
                  value={form.geofenceLng}
                  onChange={(e) => setForm({ ...form, geofenceLng: e.target.value })}
                  placeholder="77.2090, 77.2091, 77.2092"
                  disabled={saving}
                />
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowModal(false)}
                  disabled={saving}
                >
                  Cancel
                </button>
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
            <h2>Delete Hostel</h2>
            <p className="confirm-msg">
              Are you sure you want to delete this hostel? This action cannot be undone.
            </p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={() => handleDelete(deleteConfirm)}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
