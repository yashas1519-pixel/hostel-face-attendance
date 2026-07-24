"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchWithAuth } from "@/lib/auth";

type Phase = "loading" | "no-hostel" | "no-window" | "scanning" | "locked" | "capturing" | "submitting" | "done" | "error";

interface ActiveWindow { id: string; name: string; startTime: string; endTime: string; }

function getDeviceId(): string {
  let id = localStorage.getItem("device_id");
  if (!id) { id = crypto.randomUUID(); localStorage.setItem("device_id", id); }
  return id;
}

export default function MarkAttendancePage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const phaseRef = useRef<Phase>("loading");

  const [phase, setPhase] = useState<Phase>("loading");
  const [msg, setMsg] = useState("Initialising…");
  const [faceIn, setFaceIn] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const [captureCount, setCaptureCount] = useState(0);
  const [flash, setFlash] = useState(false);
  const [scanDeg, setScanDeg] = useState(0);
  const [result, setResult] = useState<{ status: string; rejectionReason?: string } | null>(null);
  const [hostelId, setHostelId] = useState<string | null>(null);
  const [window_, setWindow_] = useState<ActiveWindow | null>(null);

  const setPhaseSync = useCallback((p: Phase) => { phaseRef.current = p; setPhase(p); }, []);

  // ── Boot: check hostel assignment + active window ──────────────────────────
  useEffect(() => {
    void boot();
    return () => {
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function boot() {
    try {
      setMsg("Checking your hostel assignment…");
      const meRes = await fetchWithAuth("/auth/me");
      if (!meRes.ok) {
        setPhaseSync("error");
        setMsg("Session expired — please log in again.");
        return;
      }
      const me = await meRes.json() as { hostelId?: string | null; enrollmentStatus: string };

      if (me.enrollmentStatus !== "approved") {
        setPhaseSync("error"); setMsg("Your face enrollment must be approved first."); return;
      }
      if (!me.hostelId) { setPhaseSync("no-hostel"); return; }
      setHostelId(me.hostelId);

      setMsg("Checking check-in windows…");
      const winRes = await fetchWithAuth(`/hostel/${me.hostelId}/active-window`);
      // active-window returns the window object or null/empty when none active
      let win: ActiveWindow | null = null;
      if (winRes.ok) {
        const text = await winRes.text();
        if (text && text !== "null" && text.trim().length > 0) {
          try { win = JSON.parse(text) as ActiveWindow; } catch { win = null; }
        }
      }
      if (!win) { setPhaseSync("no-window"); return; }
      setWindow_(win);

      setMsg("Starting camera…");
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }

      setMsg("Loading face models…");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const faceapi = (await import("face-api.js")) as any;
      await faceapi.nets.tinyFaceDetector.loadFromUri("/models");
      await faceapi.nets.faceLandmark68TinyNet.loadFromUri("/models");
      await faceapi.nets.faceRecognitionNet.loadFromUri("/models");

      setPhaseSync("scanning");
      setMsg("Centre your face in the oval");
      startLoop(faceapi, me.hostelId, win);
    } catch (e) {
      setPhaseSync("error");
      setMsg(e instanceof Error ? e.message : "Setup failed");
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function startLoop(faceapi: any, hId: string, win: ActiveWindow) {
    let lastTs = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let lastResults: any[] = [];
    let angle = 0;
    let lockedSince = 0;

    const loop = async (ts: number) => {
      const p = phaseRef.current;
      if (p === "capturing" || p === "submitting" || p === "done" || p === "error") return;

      angle = (angle + 3) % 360;
      setScanDeg(angle);

      const video = videoRef.current;
      if (video && video.readyState >= 2 && ts - lastTs > 300) {
        lastTs = ts;
        try {
          lastResults = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.2 }));
        } catch { lastResults = []; }
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

      if (inOval && p === "scanning") {
        if (!lockedSince) {
          lockedSince = ts;
          setPhaseSync("locked");
          setCountdown(3);
          scheduleCapture(faceapi, hId, win);
        }
      } else if (!inOval && p === "locked") {
        lockedSince = 0;
        setPhaseSync("scanning");
        setCountdown(3);
      }

      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function scheduleCapture(faceapi: any, hId: string, win: ActiveWindow) {
    let count = 3;
    const tick = () => {
      count--;
      setCountdown(count);
      if (count <= 0) void doCapture(faceapi, hId, win);
      else setTimeout(tick, 1000);
    };
    setTimeout(tick, 1000);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doCapture = useCallback(async (faceapi: any, hId: string, win: ActiveWindow) => {
    cancelAnimationFrame(rafRef.current);
    setPhaseSync("capturing");
    const video = videoRef.current;
    if (!video) return;

    const descriptors: Float32Array[] = [];
    for (let i = 0; i < 5; i++) {
      setFlash(true);
      await new Promise((r) => setTimeout(r, 80));
      setFlash(false);
      await new Promise((r) => setTimeout(r, 420));
      setCaptureCount(i + 1);

      const res = await faceapi
        .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.2 }))
        .withFaceLandmarks(true)
        .withFaceDescriptor();
      if (!res) { setPhaseSync("error"); setMsg("Face moved — try again."); return; }
      descriptors.push(res.descriptor);
    }

    const avg = new Float32Array(128);
    for (const d of descriptors) d.forEach((v: number, i: number) => { avg[i] += v; });
    avg.forEach((_, i) => { avg[i] /= descriptors.length; });

    setPhaseSync("submitting");
    setMsg("Getting your location…");

    let lat = 0, lng = 0, accuracy = 999;
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000 })
      );
      lat = pos.coords.latitude; lng = pos.coords.longitude; accuracy = pos.coords.accuracy;
    } catch { /* use 0,0 — webSource skips polygon check */ }

    setMsg("Verifying your face…");
    try {
      const body = {
        hostelId: hId,
        checkInWindowId: win.id,
        embedding: Array.from(avg),
        livenessPassed: true,
        livenessAction: "web",
        deviceLat: lat,
        deviceLng: lng,
        gpsAccuracyM: accuracy,
        gpsSampleSpread: 0,
        mockLocationFlag: false,
        deviceId: getDeviceId(),
        webSource: true,
      };
      const r = await fetchWithAuth("/attendance/mark", { method: "POST", body: JSON.stringify(body) });
      if (!r.ok) {
        const b = await r.json().catch(() => ({})) as { message?: string };
        throw new Error(b.message ?? "Submission failed");
      }
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

  // ── UI ──────────────────────────────────────────────────────────────────────
  const scanning = phase === "scanning" || phase === "locked" || phase === "capturing";

  return (
    <div style={{
      minHeight: "100vh", background: "#000", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", fontFamily: "Inter, sans-serif",
      color: "#fff", padding: 24,
    }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 6px" }}>Mark Attendance</h1>
      <p style={{ color: "#666", fontSize: 13, margin: "0 0 28px" }}>
        {window_ ? `Window: ${window_.name} (${window_.startTime}–${window_.endTime})` : ""}
      </p>

      {/* Loading / Error / Info states */}
      {!scanning && phase !== "done" && (
        <div style={{ textAlign: "center", maxWidth: 320 }}>
          {phase === "no-hostel" && (
            <>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🏠</div>
              <p style={{ color: "#f87171", fontWeight: 600, marginBottom: 8 }}>No hostel assigned</p>
              <p style={{ color: "#666", fontSize: 13 }}>
                Ask the admin to assign you to a hostel from the Students page.
              </p>
            </>
          )}
          {phase === "no-window" && (
            <>
              <div style={{ fontSize: 48, marginBottom: 16 }}>⏰</div>
              <p style={{ color: "#fbbf24", fontWeight: 600, marginBottom: 8 }}>No active check-in window</p>
              <p style={{ color: "#666", fontSize: 13 }}>
                {`It's ${new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}. `}
                Ask the admin to create a check-in window covering this time.
              </p>
            </>
          )}
          {(phase === "loading" || phase === "submitting") && (
            <>
              <div style={{ width: 40, height: 40, border: "3px solid #333", borderTopColor: "#FF6B35", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 16px" }} />
              <p style={{ color: "#888", fontSize: 14 }}>{msg}</p>
            </>
          )}
          {phase === "error" && (
            <>
              <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
              <p style={{ color: "#f87171", fontWeight: 600, marginBottom: 16, fontSize: 14 }}>{msg}</p>
              <button onClick={() => router.push("/student")} style={{ padding: "10px 24px", background: "#1a1a1a", border: "1px solid #333", borderRadius: 8, color: "#fff", cursor: "pointer" }}>
                Back to Dashboard
              </button>
            </>
          )}
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Face scanner */}
      {scanning && (
        <div style={{ position: "relative", width: "min(360px,90vw)", aspectRatio: "1" }}>
          {/* Spinning border */}
          <div style={{
            position: "absolute", inset: -4, borderRadius: "50%",
            background: `conic-gradient(from ${scanDeg}deg, #FF6B35, #ff9a35, transparent 60%)`,
            opacity: faceIn ? 1 : 0.4, transition: "opacity 0.4s",
          }} />
          {/* Video */}
          <div style={{ position: "absolute", inset: 0, borderRadius: "50%", overflow: "hidden", background: "#111" }}>
            <video ref={videoRef} playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />
          </div>
          {/* Oval SVG overlay */}
          <svg viewBox="0 0 400 400" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
            <defs>
              <mask id="att-mask">
                <rect width="400" height="400" fill="white" />
                <ellipse cx="200" cy="185" rx="125" ry="150" fill="black" />
              </mask>
            </defs>
            <rect width="400" height="400" fill="rgba(0,0,0,0.6)" mask="url(#att-mask)" />
            <ellipse cx="200" cy="185" rx="125" ry="150" fill="none"
              stroke={faceIn ? "#34D399" : "#FF6B35"} strokeWidth="3" opacity="0.9" />
          </svg>
          {/* Flash */}
          {flash && <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.8)", borderRadius: "50%", pointerEvents: "none" }} />}

          {/* Countdown */}
          {phase === "locked" && countdown > 0 && (
            <div style={{ position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)", fontSize: 48, fontWeight: 900, color: "#FF6B35" }}>
              {countdown}
            </div>
          )}
          {/* Capture progress */}
          {phase === "capturing" && (
            <div style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 6 }}>
              {[1,2,3,4,5].map((n) => (
                <div key={n} style={{ width: 10, height: 10, borderRadius: "50%", background: n <= captureCount ? "#34D399" : "#333" }} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Instruction pill */}
      {scanning && (
        <div style={{ marginTop: 20, background: "#111", border: "1px solid #222", borderRadius: 20, padding: "8px 18px", fontSize: 13, color: faceIn ? "#34D399" : "#888" }}>
          {phase === "locked" ? `Hold still… ${countdown}` : phase === "capturing" ? `Capturing ${captureCount}/5…` : "Centre your face in the oval"}
        </div>
      )}

      {/* Result */}
      {phase === "done" && result && (
        <div style={{ textAlign: "center", maxWidth: 320 }}>
          {result.status === "present" ? (
            <>
              <div style={{ fontSize: 72, marginBottom: 16 }}>✅</div>
              <p style={{ fontSize: 22, fontWeight: 700, color: "#34D399" }}>Attendance Marked!</p>
              <p style={{ color: "#666", fontSize: 13, marginTop: 8 }}>You&apos;re marked <strong>Present</strong></p>
            </>
          ) : result.status === "flagged" ? (
            <>
              <div style={{ fontSize: 72, marginBottom: 16 }}>⚑</div>
              <p style={{ fontSize: 18, fontWeight: 700, color: "#fbbf24" }}>Flagged for Review</p>
              <p style={{ color: "#666", fontSize: 13, marginTop: 8 }}>{result.rejectionReason}</p>
            </>
          ) : (
            <>
              <div style={{ fontSize: 72, marginBottom: 16 }}>❌</div>
              <p style={{ fontSize: 18, fontWeight: 700, color: "#f87171" }}>Attendance Rejected</p>
              <p style={{ color: "#666", fontSize: 13, marginTop: 8 }}>{result.rejectionReason}</p>
            </>
          )}
          <button
            onClick={() => router.push("/student")}
            style={{ marginTop: 24, padding: "12px 32px", background: "#FF6B35", border: "none", borderRadius: 10, color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer" }}
          >
            Back to Dashboard
          </button>
        </div>
      )}

      {/* Back link */}
      {!scanning && phase !== "done" && phase !== "loading" && phase !== "submitting" && (
        <button onClick={() => router.push("/student")} style={{ marginTop: 20, background: "none", border: "none", color: "#555", fontSize: 13, cursor: "pointer" }}>
          ← Back
        </button>
      )}
    </div>
  );
}
