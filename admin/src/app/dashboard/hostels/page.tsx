"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  getHostels,
  createHostel,
  updateHostel,
  deleteHostel,
  type Hostel,
  ApiError,
} from "@/lib/api";
import { useToast } from "@/components/Toast";

// ── Leaflet is client-only ─────────────────────────────────
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    L: any;
  }
}

type LatLng = { lat: number; lng: number };

function polygonToGeoJSON(points: LatLng[]): string {
  if (points.length < 3) return "";
  const coords = [...points, points[0]].map((p) => [p.lng, p.lat]);
  return JSON.stringify({
    type: "Polygon",
    coordinates: [coords],
  });
}

function geoJSONToLatLngs(geojson: string): LatLng[] {
  try {
    const parsed = JSON.parse(geojson);
    const coords: [number, number][] = parsed?.coordinates?.[0] ?? [];
    return coords.slice(0, -1).map(([lng, lat]) => ({ lat, lng }));
  } catch {
    return [];
  }
}

// ── Leaflet Map component ─────────────────────────────────
function LeafletMap({
  initialPoints,
  onChange,
}: {
  initialPoints: LatLng[];
  onChange: (pts: LatLng[]) => void;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const polyRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<any[]>([]);
  const pointsRef = useRef<LatLng[]>(initialPoints);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (mapRef.current) return; // already mounted

    // Inject Leaflet CSS + JS dynamically
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(link);

    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.onload = () => {
      const L = window.L;
      if (!divRef.current) return;

      const map = L.map(divRef.current).setView(
        initialPoints.length > 0
          ? [initialPoints[0].lat, initialPoints[0].lng]
          : [20.5937, 78.9629], // India center default
        initialPoints.length > 0 ? 18 : 5
      );

      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        {
          attribution: "Esri satellite",
          maxZoom: 20,
        }
      ).addTo(map);

      // Also add label overlay so streets are visible
      L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
          attribution: "OSM",
          opacity: 0.3,
          maxZoom: 20,
        }
      ).addTo(map);

      mapRef.current = map;

      function redraw() {
        // Clear old markers
        markersRef.current.forEach((m) => m.remove());
        markersRef.current = [];
        if (polyRef.current) { polyRef.current.remove(); polyRef.current = null; }

        const pts = pointsRef.current;
        pts.forEach((p, i) => {
          const icon = L.divIcon({
            html: `<div style="width:14px;height:14px;border-radius:50%;background:${i === 0 ? "#FF6B35" : "#FF4D4D"};border:2px solid white;cursor:pointer;"></div>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7],
            className: "",
          });
          const marker = L.marker([p.lat, p.lng], { icon, draggable: true })
            .addTo(map)
            .on("drag", (e: { target: { getLatLng: () => { lat: number; lng: number } } }) => {
              const ll = e.target.getLatLng();
              pointsRef.current[i] = { lat: ll.lat, lng: ll.lng };
              redraw();
              onChange([...pointsRef.current]);
            })
            .on("contextmenu", () => {
              pointsRef.current.splice(i, 1);
              redraw();
              onChange([...pointsRef.current]);
            });
          markersRef.current.push(marker);
        });

        if (pts.length >= 3) {
          polyRef.current = L.polygon(
            pts.map((p) => [p.lat, p.lng]),
            { color: "#FF6B35", fillColor: "#FF6B35", fillOpacity: 0.2, weight: 2 }
          ).addTo(map);
        }
      }

      map.on("click", (e: { latlng: { lat: number; lng: number } }) => {
        pointsRef.current = [...pointsRef.current, { lat: e.latlng.lat, lng: e.latlng.lng }];
        redraw();
        onChange([...pointsRef.current]);
      });

      // Draw initial polygon if editing
      if (initialPoints.length > 0) {
        redraw();
        const bounds = L.latLngBounds(initialPoints.map((p) => [p.lat, p.lng]));
        map.fitBounds(bounds, { padding: [30, 30] });
      }
    };
    document.head.appendChild(script);

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ position: "relative" }}>
      <div ref={divRef} style={{ height: 320, borderRadius: 8, overflow: "hidden", background: "#1a1a1a" }} />
      <div style={{
        position: "absolute", bottom: 8, left: 8, zIndex: 1000,
        background: "rgba(0,0,0,0.7)", padding: "4px 10px",
        borderRadius: 6, fontSize: "0.75rem", color: "var(--text-secondary)",
      }}>
        Click map to add points • Drag to move • Right-click to remove
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────
type HostelForm = {
  name: string;
  type: "boys" | "girls";
  collegeName: string;
  wifiBssids: string;
};

const emptyForm: HostelForm = { name: "", type: "boys", collegeName: "", wifiBssids: "" };

export default function HostelsPage() {
  const [hostels, setHostels] = useState<Hostel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<HostelForm>(emptyForm);
  const [polygonPoints, setPolygonPoints] = useState<LatLng[]>([]);
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

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  function openCreate() {
    setEditId(null);
    setForm(emptyForm);
    setPolygonPoints([]);
    setShowModal(true);
  }

  function openEdit(h: Hostel) {
    setEditId(h.id);
    setForm({
      name: h.name,
      type: h.type,
      collegeName: h.collegeName,
      wifiBssids: h.wifiBssids.join(", "),
    });
    setPolygonPoints(h.boundaryPolygon ? geoJSONToLatLngs(h.boundaryPolygon) : []);
    setShowModal(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { toast("Hostel name is required", "error"); return; }
    if (polygonPoints.length < 3) { toast("Draw at least 3 points on the map to define the geofence", "error"); return; }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        type: form.type,
        collegeName: form.collegeName.trim(),
        wifiBssids: form.wifiBssids.split(",").map((s) => s.trim()).filter(Boolean),
        boundaryPolygon: polygonToGeoJSON(polygonPoints),
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
          {[1, 2, 3].map((i) => <div key={i} className="card skeleton skeleton-card" />)}
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
                <span className={`badge ${h.type === "boys" ? "badge-info" : "badge-accent"}`}>{h.type}</span>
              </div>
              <p style={{ fontSize: "0.875rem", marginBottom: 4, color: "var(--text-secondary)" }}>{h.collegeName}</p>
              <p style={{ fontSize: "0.8125rem", marginBottom: 16, color: "var(--text-tertiary)" }}>
                {h.wifiBssids.length} BSSID{h.wifiBssids.length !== 1 ? "s" : ""} •{" "}
                {h.boundaryPolygon ? (
                  <span style={{ color: "#34D399" }}>✓ Geofence set</span>
                ) : (
                  <span style={{ color: "#EF4444" }}>⚠ No geofence</span>
                )}
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => openEdit(h)}>Edit</button>
                <button className="btn btn-danger btn-sm" onClick={() => setDeleteConfirm(h.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" style={{ maxWidth: 640, width: "100%" }} onClick={(e) => e.stopPropagation()}>
            <h2>{editId ? "Edit Hostel" : "Create Hostel"}</h2>
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="form-group">
                  <label htmlFor="hostel-name" className="form-label">Name</label>
                  <input id="hostel-name" className="form-input" value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Boys Hostel A" required disabled={saving} />
                </div>
                <div className="form-group">
                  <label htmlFor="hostel-type" className="form-label">Type</label>
                  <select id="hostel-type" className="form-select" value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value as "boys" | "girls" })}
                    disabled={saving}>
                    <option value="boys">Boys</option>
                    <option value="girls">Girls</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label htmlFor="hostel-college" className="form-label">College Name</label>
                <input id="hostel-college" className="form-input" value={form.collegeName}
                  onChange={(e) => setForm({ ...form, collegeName: e.target.value })}
                  placeholder="MIT College of Engineering" disabled={saving} />
              </div>
              <div className="form-group">
                <label htmlFor="hostel-bssids" className="form-label">WiFi BSSIDs (comma-separated)</label>
                <input id="hostel-bssids" className="form-input" value={form.wifiBssids}
                  onChange={(e) => setForm({ ...form, wifiBssids: e.target.value })}
                  placeholder="AA:BB:CC:DD:EE:FF, 11:22:33:44:55:66" disabled={saving} />
              </div>

              <div className="form-group">
                <label className="form-label" style={{ marginBottom: 8 }}>
                  Geofence Polygon — Satellite Map
                  <span style={{ marginLeft: 8, fontSize: "0.75rem", color: polygonPoints.length >= 3 ? "#34D399" : "var(--text-tertiary)" }}>
                    {polygonPoints.length} point{polygonPoints.length !== 1 ? "s" : ""} {polygonPoints.length >= 3 ? "✓" : "(need ≥ 3)"}
                  </span>
                </label>
                {/* Only render map on client — LeafletMap handles its own SSR guard */}
                <LeafletMap
                  key={editId ?? "new"}
                  initialPoints={polygonPoints}
                  onChange={setPolygonPoints}
                />
                {polygonPoints.length >= 3 && (
                  <button type="button" style={{ marginTop: 6, fontSize: "0.75rem", color: "#EF4444", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                    onClick={() => setPolygonPoints([])}>
                    Clear polygon
                  </button>
                )}
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
            <h2>Delete Hostel</h2>
            <p className="confirm-msg">Are you sure? This action cannot be undone.</p>
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
