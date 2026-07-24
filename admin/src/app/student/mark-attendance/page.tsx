"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchWithAuth } from "@/lib/auth";

// ── Types ────────────────────────────────────────────────────────────────────
type Phase =
  | "loading"
  | "location-check"   // STEP 1 — GPS verification
  | "location-ok"      // GPS passed — brief confirmation before camera
  | "location-fail"    // GPS outside building
  | "no-hostel" | "no-window" | "error"
  | "scanning"         // STEP 2 — waiting for face in oval
  | "locked"           // face detected — countdown
  | "capturing"        // 5-frame embedding capture
  | "liveness"         // STEP 3 — head-direction challenge
  | "liveness-fail"    // wrong direction (brief flash)
  | "submitting"
  | "done"
  | "warden-required"; // 3 liveness failures

type Direction = "left" | "right" | "up" | "down";
interface ActiveWindow { id: string; name: string; startTime: string; endTime: string; }
interface GpsData { lat: number; lng: number; accuracy: number; spread: number; }

const DIRS: Direction[] = ["left", "right", "up", "down"];
const DIR_LABELS: Record<Direction, string> = { left: "LEFT ←", right: "RIGHT →", up: "UP ↑", down: "DOWN ↓" };
const DIR_EMOJI: Record<Direction, string> = { left: "👈", right: "👉", up: "☝️", down: "👇" };

function randomDir(): Direction { return DIRS[Math.floor(Math.random() * DIRS.length)]; }

function getDeviceId(): string {
  let id = localStorage.getItem("device_id");
  if (!id) { id = crypto.randomUUID(); localStorage.setItem("device_id", id); }
  return id;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function detectHeadDirection(landmarks: any): Direction | "center" {
  const pts = landmarks.positions as { x: number; y: number }[];
  const noseTip    = pts[30];
  const leftEye    = pts[36];
  const rightEye   = pts[45];
  const chin       = pts[8];
  const noseBridge = pts[27];
  const eyeCenterX = (leftEye.x + rightEye.x) / 2;
  const eyeCenterY = (leftEye.y + rightEye.y) / 2;
  const faceWidth  = Math.abs(rightEye.x - leftEye.x);
  const faceHeight = Math.abs(chin.y - noseBridge.y);
  const yaw   = (noseTip.x - eyeCenterX) / faceWidth;
  const pitch = (noseTip.y - eyeCenterY) / faceHeight;
  if (yaw   >  0.22) return "left";
  if (yaw   < -0.22) return "right";
  if (pitch < -0.05) return "up";
  if (pitch >  0.18) return "down";
  return "center";
}

// ── GPS helpers ───────────────────────────────────────────────────────────────
function getPosition(): Promise<GeolocationPosition> {
  return new Promise((res, rej) =>
    navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 12000 })
  );
}

// Collect 3 GPS samples over 3s, return avg + spread
async function collectGps(): Promise<GpsData> {
  const samples: { lat: number; lng: number }[] = [];
  for (let i = 0; i < 3; i++) {
    const p = await getPosition();
    samples.push({ lat: p.coords.latitude, lng: p.coords.longitude });
    if (i < 2) await new Promise((r) => setTimeout(r, 800));
  }
  const lat = samples.reduce((s, p) => s + p.lat, 0) / samples.length;
  const lng = samples.reduce((s, p) => s + p.lng, 0) / samples.length;
  const spread = Math.max(...samples.map((p) =>
    Math.sqrt((p.lat - lat) ** 2 + (p.lng - lng) ** 2) * 111_000
  ));
  const last = await getPosition();
  return { lat, lng, accuracy: last.coords.accuracy, spread };
}

// Ray-casting point-in-polygon (same algorithm as backend geo.ts)
function pointInPolygon(point: [number, number], ring: [number, number][]): boolean {
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function MarkAttendancePage() {
  const router = useRouter();
  const videoRef     = useRef<HTMLVideoElement>(null);
  const streamRef    = useRef<MediaStream | null>(null);
  const rafRef       = useRef<number>(0);
  const phaseRef     = useRef<Phase>("loading");
  const fapiRef      = useRef<unknown>(null);
  const embeddingRef = useRef<Float32Array | null>(null);
  const gpsRef       = useRef<GpsData | null>(null);

  const [phase,        setPhase]        = useState<Phase>("loading");
  const [msg,          setMsg]          = useState("Initialising…");
  const [faceIn,       setFaceIn]       = useState(false);
  const [countdown,    setCountdown]    = useState(3);
  const [captureCount, setCaptureCount] = useState(0);
  const [flash,        setFlash]        = useState(false);
  const [scanDeg,      setScanDeg]      = useState(0);
  const [challenge,    setChallenge]    = useState<Direction>("left");
  const [livenessTimer, setLivenessTimer] = useState(5);
  const [strikeCount,  setStrikeCount]  = useState(0);
  const [result,       setResult]       = useState<{ status: string; rejectionReason?: string } | null>(null);
  const [hostelId,     setHostelId]     = useState<string | null>(null);
  const [window_,      setWindow_]      = useState<ActiveWindow | null>(null);

  const setPhaseSync = useCallback((p: Phase) => { phaseRef.current = p; setPhase(p); }, []);

  useEffect(() => {
    void boot();
    return () => { cancelAnimationFrame(rafRef.current); streamRef.current?.getTracks().forEach((t) => t.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Boot — hostel + window check ─────────────────────────────────────────
  async function boot() {
    setPhaseSync("loading");
    try {
      setMsg("Checking hostel assignment…");
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20_000);
      let meRes: Response;
      try {
        meRes = await fetchWithAuth("/auth/me", { signal: ctrl.signal });
        clearTimeout(timer);
      } catch (fetchErr) {
        clearTimeout(timer);
        if (fetchErr instanceof Error && fetchErr.name === "AbortError") {
          setPhaseSync("error");
          setMsg("Server is starting up — please wait 30s then retry.");
          return;
        }
        throw fetchErr;
      }

      if (!meRes.ok) { setPhaseSync("error"); setMsg("Session expired."); return; }
      const me = await meRes.json() as { hostelId?: string | null; enrollmentStatus: string };
      if (me.enrollmentStatus !== "approved") { setPhaseSync("error"); setMsg("Face enrollment must be approved first."); return; }
      if (!me.hostelId) { setPhaseSync("no-hostel"); return; }
      const hId: string = me.hostelId;
      setHostelId(hId);

      setMsg("Checking check-in windows…");
      const winRes = await fetchWithAuth(`/hostel/${hId}/active-window`);
      let win: ActiveWindow | null = null;
      if (winRes.ok) {
        const text = await winRes.text();
        if (text && text !== "null" && text.trim().length > 0) {
          try { win = JSON.parse(text) as ActiveWindow; } catch { win = null; }
        }
      }
      if (!win) { setPhaseSync("no-window"); return; }
      const checkedWin: ActiveWindow = win;
      setWindow_(checkedWin);

      // ── STEP 1: Location check ──────────────────────────────────────────
      setPhaseSync("location-check");
      setMsg("Getting your location…");
      try {
        // Fetch hostel boundary polygon
        const hostelRes = await fetchWithAuth(`/hostel/${hId}`);
        let boundaryRing: [number, number][] | null = null;
        if (hostelRes.ok) {
          const hostelData = await hostelRes.json() as { boundaryPolygon?: string | null };
          if (hostelData.boundaryPolygon) {
            try {
              const geo = JSON.parse(hostelData.boundaryPolygon) as { coordinates: [number, number][][] };
              boundaryRing = geo.coordinates[0] ?? null;
            } catch { boundaryRing = null; }
          }
        }

        // Get GPS
        setMsg("Locating you…");
        const gps = await collectGps();
        gpsRef.current = gps;

        // Check if inside building polygon (skip if no polygon configured)
        if (boundaryRing && boundaryRing.length >= 3) {
          const inside = pointInPolygon([gps.lng, gps.lat], boundaryRing);
          if (!inside) {
            setPhaseSync("location-fail");
            setMsg("You are not inside the hostel building. Please go to your hostel and try again.");
            return;
          }
        }
        // No polygon configured — skip geofence (admin hasn't drawn boundary yet)

        setPhaseSync("location-ok");
        await new Promise((r) => setTimeout(r, 1500));
        await startCamera(hId, checkedWin);
      } catch (locErr) {
        setPhaseSync("location-fail");
        setMsg(locErr instanceof Error && locErr.code === 1
          ? "Location permission denied. Please allow location access."
          : "Could not get your location. Try again.");
      }
    } catch (e) {
      setPhaseSync("error");
      setMsg(e instanceof Error ? e.message : "Setup failed");
    }
  }

  // ── STEP 2: Camera + face models ─────────────────────────────────────────
  async function startCamera(hId: string, win: ActiveWindow) {
    setMsg("Starting camera…");
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
    streamRef.current = stream;

    setMsg("Loading face models…");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const faceapi = (await import("face-api.js")) as any;
    await faceapi.nets.tinyFaceDetector.loadFromUri("/models");
    await faceapi.nets.faceLandmark68TinyNet.loadFromUri("/models");
    await faceapi.nets.faceRecognitionNet.loadFromUri("/models");
    fapiRef.current = faceapi;

    setPhaseSync("scanning");
    setMsg("Centre your face in the oval");
    setTimeout(() => {
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play();
      }
      startScanLoop(faceapi, hId, win);
    }, 100);
  }

  // ── Scan loop ────────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function startScanLoop(faceapi: any, hId: string, win: ActiveWindow) {
    let lastTs = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let lastResults: any[] = [];
    let angle = 0;
    let locked = false;

    const loop = async (ts: number) => {
      const p = phaseRef.current;
      if (["capturing","liveness","liveness-fail","submitting","done","error","warden-required"].includes(p)) return;

      angle = (angle + 3) % 360;
      setScanDeg(angle);

      const video = videoRef.current;
      if (video && video.readyState >= 2 && ts - lastTs > 300) {
        lastTs = ts;
        try { lastResults = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.45 })); }
        catch { lastResults = []; }
      }

      let inOval = false;
      if (video && lastResults.length >= 1) {
        const vw = video.videoWidth || 640, vh = video.videoHeight || 640;
        const box = lastResults[0].box;
        const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
        const ox = vw * 0.5, oy = vh * 0.45, rx = vw * 0.32, ry = vh * 0.38;
        inOval = ((cx - ox) / rx) ** 2 + ((cy - oy) / ry) ** 2 <= 1.2;
      }
      setFaceIn(inOval);

      if (inOval && p === "scanning" && !locked) {
        locked = true;
        setPhaseSync("locked");
        setCountdown(3);
        let c = 3;
        const tick = () => { c--; setCountdown(c); if (c <= 0) void doCapture(faceapi, hId, win); else setTimeout(tick, 1000); };
        setTimeout(tick, 1000);
      } else if (!inOval && p === "locked") {
        locked = false;
        setPhaseSync("scanning");
        setCountdown(3);
      }

      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }

  // ── STEP 2b: Capture embedding ────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doCapture = useCallback(async (faceapi: any, hId: string, win: ActiveWindow) => {
    cancelAnimationFrame(rafRef.current);
    setPhaseSync("capturing");
    const video = videoRef.current;
    if (!video) return;

    const descriptors: Float32Array[] = [];
    for (let i = 0; i < 5; i++) {
      setFlash(true); await new Promise((r) => setTimeout(r, 80));
      setFlash(false); await new Promise((r) => setTimeout(r, 420));
      setCaptureCount(i + 1);
      const res = await faceapi
        .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.55 }))
        .withFaceLandmarks(true).withFaceDescriptor();
      if (!res) { setPhaseSync("error"); setMsg("Face moved during capture — try again."); return; }
      descriptors.push(res.descriptor);
    }
    const avg = new Float32Array(128);
    for (const d of descriptors) d.forEach((v: number, i: number) => { avg[i] += v; });
    avg.forEach((_, i) => { avg[i] /= descriptors.length; });
    embeddingRef.current = avg;

    // ── STEP 3: Liveness challenge ──────────────────────────────────────────
    const dir = randomDir();
    setChallenge(dir);
    setLivenessTimer(10);
    setPhaseSync("liveness");
    startLivenessLoop(faceapi, dir, hId, win, 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── STEP 3: Liveness loop ─────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function startLivenessLoop(faceapi: any, dir: Direction, hId: string, win: ActiveWindow, strikes: number) {
    let lastTs = 0;
    let timeLeft = 10;
    setLivenessTimer(10);
    // Ensure video is still playing after a retry
    void videoRef.current?.play().catch(() => {});
    const timerInterval = setInterval(() => {
      timeLeft--;
      setLivenessTimer(timeLeft);
      if (timeLeft <= 0) {
        clearInterval(timerInterval);
        cancelAnimationFrame(rafRef.current);
        handleLivenessFail(faceapi, hId, win, strikes);
      }
    }, 1000);

    const loop = async (ts: number) => {
      const p = phaseRef.current;
      if (p !== "liveness") { clearInterval(timerInterval); return; }
      const video = videoRef.current;
      if (video && video.readyState >= 2 && ts - lastTs > 150) {
        lastTs = ts;
        try {
          const res = await faceapi
            .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.3 }))
            .withFaceLandmarks(true);
          if (res) {
            const detected = detectHeadDirection(res.landmarks);
            if (detected === dir) {
              clearInterval(timerInterval);
              cancelAnimationFrame(rafRef.current);
              void submit(hId, win);
              return;
            }
          }
        } catch { /* ignore */ }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }

  function handleLivenessFail(faceapi: unknown, hId: string, win: ActiveWindow, strikes: number) {
    const newStrikes = strikes + 1;
    setStrikeCount(newStrikes);
    if (newStrikes >= 3) {
      setPhaseSync("warden-required");
      void fetchWithAuth("/attendance/liveness-failure", {
        method: "POST",
        body: JSON.stringify({ hostelId: hId }),
      });
    } else {
      const newDir = randomDir();
      setChallenge(newDir);
      setLivenessTimer(10);
      setPhaseSync("liveness-fail");
      setTimeout(() => {
        // Re-attach stream if video went blank during the pause
        if (videoRef.current && streamRef.current) {
          if (!videoRef.current.srcObject) videoRef.current.srcObject = streamRef.current;
          void videoRef.current.play().catch(() => {});
        }
        setPhaseSync("liveness");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        startLivenessLoop(faceapi as any, newDir, hId, win, newStrikes);
      }, 2000);
    }
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  const submit = useCallback(async (hId: string, win: ActiveWindow) => {
    setPhaseSync("submitting");
    const avg = embeddingRef.current;
    if (!avg) { setPhaseSync("error"); setMsg("No face data captured."); return; }
    const gps = gpsRef.current ?? { lat: 0, lng: 0, accuracy: 999, spread: 0 };
    try {
      const r = await fetchWithAuth("/attendance/mark", {
        method: "POST",
        body: JSON.stringify({
          hostelId: hId, checkInWindowId: win.id,
          embedding: Array.from(avg),
          livenessPassed: true, livenessAction: "head-movement",
          deviceLat: gps.lat, deviceLng: gps.lng,
          gpsAccuracyM: gps.accuracy, gpsSampleSpread: gps.spread,
          mockLocationFlag: false, deviceId: getDeviceId(), webSource: false,
        }),
      });
      if (!r.ok) { const b = await r.json().catch(() => ({})) as { message?: string }; throw new Error(b.message ?? "Submission failed"); }
      const rec = await r.json() as { status: string; rejectionReason?: string };
      setResult(rec);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      setPhaseSync("done");
    } catch (e) {
      setPhaseSync("error");
      setMsg(e instanceof Error ? e.message : "Submission failed");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  const scanning = ["scanning","locked","capturing","liveness","liveness-fail"].includes(phase);

  return (
    <div style={{ minHeight: "100vh", background: "#000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "Inter, sans-serif", color: "#fff", padding: 24 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 6px" }}>Mark Attendance</h1>
      <p style={{ color: "#555", fontSize: 13, margin: "0 0 28px" }}>
        {window_ ? `Window: ${window_.name} (${window_.startTime}–${window_.endTime})` : ""}
      </p>

      {/* ── Step indicators ── */}
      {["location-check","location-ok","scanning","locked","capturing","liveness","liveness-fail"].includes(phase) && (
        <div style={{ display: "flex", gap: 8, marginBottom: 28, alignItems: "center" }}>
          {[
            { label: "Location", phases: ["location-check","location-ok"], done: ["scanning","locked","capturing","liveness","liveness-fail","submitting","done"] },
            { label: "Face", phases: ["scanning","locked","capturing"], done: ["liveness","liveness-fail","submitting","done"] },
            { label: "Liveness", phases: ["liveness","liveness-fail"], done: ["submitting","done"] },
          ].map((step, i) => {
            const active = step.phases.includes(phase);
            const done = step.done.includes(phase);
            return (
              <div key={step.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {i > 0 && <div style={{ width: 28, height: 1, background: done ? "#34D399" : "#222" }} />}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: done ? "#34D399" : active ? "#FF6B35" : "#1a1a1a", border: `2px solid ${done ? "#34D399" : active ? "#FF6B35" : "#333"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, transition: "all 0.3s" }}>
                    {done ? "✓" : i + 1}
                  </div>
                  <span style={{ fontSize: 10, color: done ? "#34D399" : active ? "#FF6B35" : "#444" }}>{step.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── STEP 1: Location phases ── */}
      {phase === "location-check" && (
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 80, height: 80, borderRadius: "50%", background: "#0a1a2a", border: "3px solid #1e3a5f", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, margin: "0 auto 20px", animation: "pulse 1.5s infinite" }}>
            📍
          </div>
          <p style={{ color: "#60a5fa", fontWeight: 600, fontSize: 16, marginBottom: 8 }}>Verifying your location…</p>
          <p style={{ color: "#444", fontSize: 13 }}>Please allow location access when prompted</p>
        </div>
      )}

      {phase === "location-ok" && (
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 80, height: 80, borderRadius: "50%", background: "#0a2a1a", border: "3px solid #34D399", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, margin: "0 auto 20px" }}>
            ✅
          </div>
          <p style={{ color: "#34D399", fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Location Verified!</p>
          <p style={{ color: "#444", fontSize: 13 }}>Starting camera…</p>
        </div>
      )}

      {phase === "location-fail" && (
        <div style={{ textAlign: "center", maxWidth: 300 }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>📍</div>
          <p style={{ color: "#f87171", fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Location Unavailable</p>
          <p style={{ color: "#666", fontSize: 13, marginBottom: 20 }}>{msg}</p>
          <button onClick={() => void boot()} style={{ padding: "10px 24px", background: "#FF6B35", border: "none", borderRadius: 8, color: "#fff", fontWeight: 700, cursor: "pointer", marginRight: 10 }}>Retry</button>
          <button onClick={() => router.push("/student")} style={{ padding: "10px 24px", background: "#1a1a1a", border: "1px solid #333", borderRadius: 8, color: "#fff", cursor: "pointer" }}>Back</button>
        </div>
      )}

      {/* ── Non-camera info states ── */}
      {!scanning && !["done","location-check","location-ok","location-fail"].includes(phase) && (
        <div style={{ textAlign: "center", maxWidth: 320 }}>
          {phase === "no-hostel" && (<><div style={{ fontSize: 48, marginBottom: 16 }}>🏠</div><p style={{ color: "#f87171", fontWeight: 600 }}>No hostel assigned</p><p style={{ color: "#666", fontSize: 13 }}>Ask admin to assign you to a hostel.</p></>)}
          {phase === "no-window" && (<><div style={{ fontSize: 48, marginBottom: 16 }}>⏰</div><p style={{ color: "#fbbf24", fontWeight: 600 }}>No active check-in window</p><p style={{ color: "#666", fontSize: 13 }}>{`It's ${new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}. Ask admin to create a window.`}</p></>)}
          {(phase === "loading" || phase === "submitting") && (<><div style={{ width: 40, height: 40, border: "3px solid #333", borderTopColor: "#FF6B35", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 16px" }} /><p style={{ color: "#888", fontSize: 14 }}>{msg}</p></>)}
          {phase === "error" && (<><div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div><p style={{ color: "#f87171", fontWeight: 600, fontSize: 14, marginBottom: 16 }}>{msg}</p><div style={{ display: "flex", gap: 10, justifyContent: "center" }}><button onClick={() => void boot()} style={{ padding: "10px 24px", background: "#FF6B35", border: "none", borderRadius: 8, color: "#fff", fontWeight: 700, cursor: "pointer" }}>Retry</button><button onClick={() => router.push("/student")} style={{ padding: "10px 24px", background: "#1a1a1a", border: "1px solid #333", borderRadius: 8, color: "#fff", cursor: "pointer" }}>Back</button></div></>)}
          {phase === "warden-required" && (
            <div style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 18, padding: 28 }}>
              <div style={{ fontSize: 56, marginBottom: 16 }}>🔐</div>
              <p style={{ color: "#f87171", fontWeight: 700, fontSize: 18, marginBottom: 8 }}>3 Liveness Failures</p>
              <p style={{ color: "#888", fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
                Please visit your <strong style={{ color: "#fff" }}>hostel warden</strong> to get your attendance marked manually.<br /><br />
                This incident has been reported.
              </p>
              <button onClick={() => router.push("/student")} style={{ padding: "12px 28px", background: "#FF6B35", border: "none", borderRadius: 10, color: "#fff", fontWeight: 700, cursor: "pointer" }}>
                Go to Dashboard
              </button>
            </div>
          )}
          <style>{`@keyframes spin { to { transform: rotate(360deg); } } @keyframes pulse { 0%,100%{opacity:0.6} 50%{opacity:1} }`}</style>
        </div>
      )}

      {/* ── STEP 2: Face scanner oval ── */}
      {scanning && (
        <div style={{ position: "relative", width: "min(340px,88vw)", aspectRatio: "1" }}>
          <div style={{ position: "absolute", inset: -4, borderRadius: "50%", background: `conic-gradient(from ${scanDeg}deg, #FF6B35, #ff9a35, transparent 60%)`, opacity: faceIn ? 1 : 0.4, transition: "opacity 0.4s" }} />
          <div style={{ position: "absolute", inset: 0, borderRadius: "50%", overflow: "hidden", background: "#111" }}>
            <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)", display: "block" }} onLoadedMetadata={() => { void videoRef.current?.play(); }} />
          </div>
          <svg viewBox="0 0 400 400" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
            <defs><mask id="m1"><rect width="400" height="400" fill="white" /><ellipse cx="200" cy="185" rx="125" ry="150" fill="black" /></mask></defs>
            <rect width="400" height="400" fill="rgba(0,0,0,0.55)" mask="url(#m1)" />
            <ellipse cx="200" cy="185" rx="125" ry="150" fill="none" stroke={faceIn ? "#34D399" : "#FF6B35"} strokeWidth="3" opacity="0.9" />
          </svg>
          {flash && <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.85)", borderRadius: "50%", pointerEvents: "none" }} />}
          {phase === "locked" && countdown > 0 && <div style={{ position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)", fontSize: 52, fontWeight: 900, color: "#FF6B35" }}>{countdown}</div>}
          {phase === "capturing" && (
            <div style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 6 }}>
              {[1,2,3,4,5].map((n) => <div key={n} style={{ width: 10, height: 10, borderRadius: "50%", background: n <= captureCount ? "#34D399" : "#333" }} />)}
            </div>
          )}
          {/* STEP 3: Liveness overlay on video */}
          {(phase === "liveness" || phase === "liveness-fail") && (
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", paddingBottom: 20, pointerEvents: "none" }}>
              <div style={{ background: phase === "liveness-fail" ? "rgba(248,113,113,0.9)" : "rgba(0,0,0,0.75)", borderRadius: 12, padding: "10px 20px", textAlign: "center" }}>
                {phase === "liveness-fail"
                  ? <span style={{ fontWeight: 700, fontSize: 14, color: "#fff" }}>❌ Wrong direction! Retry…</span>
                  : <span style={{ fontWeight: 700, fontSize: 15 }}>{DIR_EMOJI[challenge]} Look {DIR_LABELS[challenge]}</span>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* STEP 3: Liveness panel below oval */}
      {(phase === "liveness" || phase === "liveness-fail") && (
        <div style={{ marginTop: 20, textAlign: "center" }}>
          {phase === "liveness" && (
            <div style={{ background: "rgba(255,107,53,0.12)", border: "1px solid rgba(255,107,53,0.4)", borderRadius: 14, padding: "14px 24px", minWidth: 220 }}>
              <p style={{ margin: "0 0 6px", fontSize: 13, color: "#888" }}>Liveness Check</p>
              <p style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>{DIR_EMOJI[challenge]} {DIR_LABELS[challenge]}</p>
              <div style={{ marginTop: 10, height: 4, background: "#222", borderRadius: 2 }}>
                <div style={{ height: "100%", width: `${(livenessTimer / 5) * 100}%`, background: livenessTimer > 2 ? "#34D399" : "#f87171", borderRadius: 2, transition: "width 1s linear, background 0.3s" }} />
              </div>
              <p style={{ margin: "6px 0 0", fontSize: 12, color: "#555" }}>{livenessTimer}s remaining · attempt {strikeCount + 1}/3</p>
            </div>
          )}
        </div>
      )}

      {/* Instruction pill */}
      {["scanning","locked","capturing"].includes(phase) && (
        <div style={{ marginTop: 20, background: "#111", border: "1px solid #222", borderRadius: 20, padding: "8px 18px", fontSize: 13, color: faceIn ? "#34D399" : "#888" }}>
          {phase === "locked" ? `Hold still… ${countdown}` : phase === "capturing" ? `Capturing ${captureCount}/5…` : "Centre your face in the oval"}
        </div>
      )}

      {/* Result */}
      {phase === "done" && result && (
        <div style={{ textAlign: "center", maxWidth: 320 }}>
          {result.status === "present" && <><div style={{ fontSize: 72, marginBottom: 16 }}>✅</div><p style={{ fontSize: 22, fontWeight: 700, color: "#34D399" }}>Attendance Marked!</p><p style={{ color: "#666", fontSize: 13, marginTop: 8 }}>You&apos;re marked <strong>Present</strong></p></>}
          {result.status === "flagged" && <><div style={{ fontSize: 72, marginBottom: 16 }}>⚑</div><p style={{ fontSize: 18, fontWeight: 700, color: "#fbbf24" }}>Flagged for Review</p><p style={{ color: "#666", fontSize: 13, marginTop: 8 }}>{result.rejectionReason}</p></>}
          {result.status === "rejected" && <><div style={{ fontSize: 72, marginBottom: 16 }}>❌</div><p style={{ fontSize: 18, fontWeight: 700, color: "#f87171" }}>Attendance Rejected</p><p style={{ color: "#666", fontSize: 13, marginTop: 8 }}>{result.rejectionReason}</p></>}
          <button onClick={() => router.push("/student")} style={{ marginTop: 24, padding: "12px 32px", background: "#FF6B35", border: "none", borderRadius: 10, color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer" }}>Back to Dashboard</button>
        </div>
      )}

      {!scanning && !["done","loading","submitting","warden-required","location-check","location-ok"].includes(phase) && (
        <button onClick={() => router.push("/student")} style={{ marginTop: 20, background: "none", border: "none", color: "#555", fontSize: 13, cursor: "pointer" }}>← Back</button>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } } @keyframes pulse { 0%,100%{opacity:0.5} 50%{opacity:1} }`}</style>
    </div>
  );
}
