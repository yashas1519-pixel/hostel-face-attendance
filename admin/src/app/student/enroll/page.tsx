"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { fetchWithAuth } from "@/lib/auth";

type Phase =
  | "permission"
  | "loading"
  | "ready"       // scanning for face
  | "locked"      // face found, countdown
  | "capturing"   // 15 frames across 3 angles
  | "submitting"
  | "done"
  | "error";

export default function EnrollPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [phase, setPhase] = useState<Phase>("permission");
  const [loadPct, setLoadPct] = useState(0);
  const [loadMsg, setLoadMsg] = useState("Starting camera…");
  const [faceIn, setFaceIn] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const [captureCount, setCaptureCount] = useState(0);
  const [flash, setFlash] = useState(false);
  const [scanDeg, setScanDeg] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // mutable refs so the RAF loop can read latest values
  const phaseRef = useRef<Phase>("permission");
  const faceInRef = useRef(false);
  const lockedSinceRef = useRef<number | null>(null);

  function setPhaseSync(p: Phase) {
    phaseRef.current = p;
    setPhase(p);
  }

  function setFaceInSync(v: boolean) {
    faceInRef.current = v;
    setFaceIn(v);
  }

  useEffect(() => {
    void init();
    return () => {
      cancelAnimationFrame(rafRef.current);
      if (countdownTimerRef.current) clearTimeout(countdownTimerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function init() {
    const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
    try {
      const consentRes = await fetch(`${API}/consent/status`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token') ?? ''}` },
      });
      if (consentRes.ok) {
        const consentData = await consentRes.json() as { consented: boolean };
        if (!consentData.consented) {
          router.push('/student/consent');
          return;
        }
      }
    } catch {
      // ignore
    }

    // ── Camera first ──────────────────────────────────────────────
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
    } catch {
      setError("Camera access denied — please allow camera and reload.");
      setPhaseSync("error");
      return;
    }

    // ── Load models from /public/models (no CDN dependency) ───────
    setPhaseSync("loading");
    setLoadMsg("Loading face detector…");
    setLoadPct(5);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const faceapi = (await import("face-api.js")) as any;
      await faceapi.nets.tinyFaceDetector.loadFromUri("/models");
      setLoadPct(40);
      setLoadMsg("Loading landmark model…");
      await faceapi.nets.faceLandmark68TinyNet.loadFromUri("/models");
      setLoadPct(70);
      setLoadMsg("Loading recognition model…");
      await faceapi.nets.faceRecognitionNet.loadFromUri("/models");
      setLoadPct(100);
      setPhaseSync("ready");
      startLoop(faceapi);
    } catch (e) {
      setError(`Model load failed: ${e instanceof Error ? e.message : String(e)}`);
      setPhaseSync("error");
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function startLoop(faceapi: any) {
    let lastDetectTs = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let lastResults: any[] = [];
    let angleVal = 0;

    const loop = async (ts: number) => {
      const p = phaseRef.current;
      if (p === "capturing" || p === "submitting" || p === "done" || p === "error") return;

      // Spin the border
      angleVal = (angleVal + 3) % 360;
      setScanDeg(angleVal);

      // Detect every 300 ms
      const video = videoRef.current;
      if (video && video.readyState >= 2 && ts - lastDetectTs > 300) {
        lastDetectTs = ts;
        try {
          // Bare detection only — no descriptors in realtime loop (fast, no recognition model needed)
          lastResults = await faceapi
            .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }));
        } catch {
          lastResults = [];
        }
      }

      // Is the face centred in the oval?
      let inOval = false;
      if (video && lastResults.length >= 1) {
        const vw = video.videoWidth || 640;
        const vh = video.videoHeight || 640;
        // bare detectAllFaces returns Detection objects directly (not wrapped)
        const box = lastResults[0].box;
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        const ox = vw * 0.5, oy = vh * 0.45, rx = vw * 0.32, ry = vh * 0.38;
        inOval = ((cx - ox) / rx) ** 2 + ((cy - oy) / ry) ** 2 <= 1.2; // slightly generous
      }

      setFaceInSync(inOval);

      // ── Auto-countdown when face is locked ────────────────────
      if (inOval && p === "ready") {
        if (!lockedSinceRef.current) {
          lockedSinceRef.current = ts;
          setPhaseSync("locked");
          setCountdown(3);
          scheduleCapture(faceapi, ts);
        }
      } else if (!inOval && p === "locked") {
        // Face moved — reset
        lockedSinceRef.current = null;
        if (countdownTimerRef.current) clearTimeout(countdownTimerRef.current);
        setPhaseSync("ready");
        setCountdown(3);
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function scheduleCapture(faceapi: any, _startTs: number) {
    // Countdown 3 → 2 → 1 then capture
    let count = 3;
    const tick = () => {
      count -= 1;
      setCountdown(count);
      if (count <= 0) {
        void doCapture(faceapi);
      } else {
        countdownTimerRef.current = setTimeout(tick, 1000);
      }
    };
    countdownTimerRef.current = setTimeout(tick, 1000);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doCapture = useCallback(async (faceapi: any) => {
    cancelAnimationFrame(rafRef.current);
    setPhaseSync("capturing");
    const video = videoRef.current;
    if (!video) return;

    // ── Liveness check ─────────────────────────────────────────────────
    setCaptureCount(-1);
    let livenessDetected = false;
    const livenessStart = Date.now();
    while (Date.now() - livenessStart < 3000) {
      const liveResult = await faceapi
        .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }))
        .withFaceLandmarks(true);
      if (liveResult) {
        const landmarks = liveResult.landmarks;
        const noseTip = landmarks.getNose()[3]; // bottom of nose
        const leftEye = landmarks.getLeftEye()[0];
        const rightEye = landmarks.getRightEye()[3];
        const faceCenter = (leftEye.x + rightEye.x) / 2;
        const faceWidth = Math.abs(rightEye.x - leftEye.x);
        const offset = noseTip.x - faceCenter;
        if (offset < -faceWidth * 0.15) {
          // Head turned left — liveness passed
          livenessDetected = true;
          break;
        }
      }
      await new Promise(r => setTimeout(r, 100));
    }
    
    if (!livenessDetected) {
      setError("Please turn your head slightly left to prove you are present");
      setPhaseSync("error");
      return;
    }
    setCaptureCount(0);
    setError("");

    // ── Snap photo on first frame for admin preview ────────────────────
    let facePhoto: string | undefined;
    try {
      const snap = document.createElement("canvas");
      snap.width = 200; snap.height = 200;
      const ctx = snap.getContext("2d")!;
      // mirror + crop-to-square from video centre
      const side = Math.min(video.videoWidth, video.videoHeight);
      const ox = (video.videoWidth - side) / 2;
      const oy = (video.videoHeight - side) / 2;
      ctx.scale(-1, 1); ctx.translate(-200, 0); // mirror to match what user sees
      ctx.drawImage(video, ox, oy, side, side, 0, 0, 200, 200);
      facePhoto = snap.toDataURL("image/jpeg", 0.6); // ~5-15KB base64
    } catch { /* non-critical */ }

    const descriptors: Float32Array[] = [];
    // 15 frames: 5 facing straight, 5 slight left, 5 slight right
    // This makes the stored embedding robust to minor pose/appearance changes (beard, glasses)
    const ANGLES = [
      { label: "Look straight", frames: 5 },
      { label: "Turn slightly LEFT", frames: 5 },
      { label: "Turn slightly RIGHT", frames: 5 },
    ];
    let framesDone = 0;

    for (const angle of ANGLES) {
      // Show direction hint in UI
      setError(""); // clear any previous
      // Brief pause so user can adjust
      setCaptureCount(framesDone);
      await new Promise((r) => setTimeout(r, 800));

      for (let i = 0; i < angle.frames; i++) {
        setFlash(true);
        await new Promise((r) => setTimeout(r, 80));
        setFlash(false);
        await new Promise((r) => setTimeout(r, 420));
        framesDone++;
        setCaptureCount(framesDone);

        // High-accuracy capture: inputSize 512, threshold 0.5
        const result = await faceapi
          .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.5 }))
          .withFaceLandmarks(true)
          .withFaceDescriptor();

        if (!result) {
          setError("Face not detected clearly — keep still and ensure good lighting.");
          setPhaseSync("error");
          return;
        }

        // Face quality gate: must be large enough (min 15% of video width)
        const minFaceRatio = 0.15;
        const faceRatio = result.detection.box.width / (video.videoWidth || 640);
        if (faceRatio < minFaceRatio) {
          setError("Move closer to the camera.");
          setPhaseSync("error");
          return;
        }

        descriptors.push(result.descriptor);
      }
    }

    // Average
    const avg = new Float32Array(128);
    for (const d of descriptors) d.forEach((v: number, i: number) => { avg[i] += v; });
    avg.forEach((_, i) => { avg[i] /= descriptors.length; });

    setPhaseSync("submitting");
    try {
      const res = await fetchWithAuth("/enrollment/submit", {
        method: "POST",
        body: JSON.stringify({ embedding: Array.from(avg), facePhoto }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(b.message ?? "Submission failed");
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      setPhaseSync("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submission failed");
      setPhaseSync("error");
    }
  }, []);

  // ── Derived ──────────────────────────────────────────────────────────
  const isScanning = phase === "ready" || phase === "locked";
  const borderColor = phase === "locked" ? "#22c55e" : faceIn ? "#22c55e" : "rgba(255,255,255,0.35)";
  const glowColor = phase === "locked" ? "0 0 0 4px rgba(34,197,94,0.25)" : "none";
  const conicGrad = `conic-gradient(from ${scanDeg}deg, transparent 0deg, ${borderColor} 60deg, transparent 120deg)`;

  const statusText = {
    permission: "Requesting camera…",
    loading: loadMsg,
    ready: "Position your face inside the oval",
    locked: `Hold still… ${countdown}`,
    capturing: captureCount === -1 ? "Turn your head SLIGHTLY LEFT then back to center" : `Scanning… ${captureCount} / 15 — ${captureCount < 5 ? "Look straight" : captureCount < 10 ? "Turn slightly LEFT" : "Turn slightly RIGHT"}`,
    submitting: "Uploading securely…",
    done: "Enrollment submitted!",
    error: error ?? "Something went wrong",
  }[phase];

  return (
    <div style={{
      minHeight: "100vh",
      background: "#000",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'Inter', -apple-system, sans-serif",
      overflow: "hidden",
    }}>
      {/* ── Done screen ─────────────────────────────────────── */}
      {phase === "done" && (
        <div style={{ textAlign: "center", padding: 32 }}>
          <div style={{
            width: 100, height: 100, borderRadius: "50%",
            background: "rgba(34,197,94,0.15)",
            border: "2px solid #22c55e",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 48, margin: "0 auto 24px",
            boxShadow: "0 0 40px rgba(34,197,94,0.3)",
          }}>✓</div>
          <h2 style={{ color: "#fff", fontSize: 22, margin: "0 0 10px" }}>Face Enrolled!</h2>
          <p style={{ color: "#555", fontSize: 14, maxWidth: 280, margin: "0 auto 28px" }}>
            Awaiting admin approval. Once approved, use the mobile app to mark attendance.
          </p>
          <button
            onClick={() => router.push("/student")}
            style={{
              background: "linear-gradient(135deg,#ff5a5a,#ff8a5a)",
              border: "none", borderRadius: 14, color: "#fff",
              padding: "14px 36px", fontWeight: 700, fontSize: 15, cursor: "pointer",
            }}
          >
            Go to Dashboard →
          </button>
        </div>
      )}

      {/* ── Error screen ────────────────────────────────────── */}
      {phase === "error" && (
        <div style={{ textAlign: "center", padding: 32, maxWidth: 320 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <p style={{ color: "#ff5a5a", fontSize: 15, marginBottom: 24 }}>{error}</p>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: "#1a1a1a", border: "1px solid #333", borderRadius: 12,
              color: "#aaa", padding: "11px 28px", cursor: "pointer", fontSize: 14,
            }}
          >
            Try Again
          </button>
        </div>
      )}

      {/* ── Camera scanning screen ───────────────────────────── */}
      {phase !== "done" && phase !== "error" && (
        <div style={{ width: "100%", maxWidth: 420, padding: "0 16px" }}>
          {/* Title */}
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <h1 style={{ color: "#fff", fontSize: 20, fontWeight: 700, margin: "0 0 4px" }}>
              Face Enrollment
            </h1>
            <p style={{ color: "#555", fontSize: 13, margin: 0 }}>
              One-time setup for attendance
            </p>
          </div>

          {/* Camera + oval */}
          <div style={{
            position: "relative",
            width: "100%",
            paddingBottom: "100%", // square
            borderRadius: 28,
            overflow: "hidden",
            background: "#111",
          }}>
            {/* Video */}
            <video
              ref={videoRef}
              autoPlay muted playsInline
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                transform: "scaleX(-1)",
              }}
            />

            {/* Photo flash */}
            {flash && (
              <div style={{
                position: "absolute", inset: 0,
                background: "white", opacity: 0.9, zIndex: 20,
              }} />
            )}

            {/* Dark vignette overlay with oval cutout */}
            <svg
              viewBox="0 0 400 400"
              style={{
                position: "absolute", inset: 0,
                width: "100%", height: "100%",
                zIndex: 3, pointerEvents: "none",
              }}
            >
              <defs>
                <mask id="oval-mask">
                  <rect width="400" height="400" fill="white" />
                  <ellipse cx="200" cy="185" rx="130" ry="155" fill="black" />
                </mask>
              </defs>
              {/* Dark surround */}
              <rect width="400" height="400" fill="rgba(0,0,0,0.55)" mask="url(#oval-mask)" />
            </svg>

            {/* Spinning border around oval */}
            <div style={{
              position: "absolute",
              top: "50%", left: "50%",
              transform: "translate(-50%, -54%)",
              width: "66%", height: "78%",
              zIndex: 4, pointerEvents: "none",
            }}>
              <svg viewBox="0 0 260 310" style={{ width: "100%", height: "100%", overflow: "visible" }}>
                <defs>
                  <linearGradient id="spin-grad" gradientTransform={`rotate(${scanDeg}, 0.5, 0.5)`} gradientUnits="objectBoundingBox">
                    <stop offset="0%" stopColor="transparent" />
                    <stop offset="30%" stopColor={borderColor} stopOpacity="0.9" />
                    <stop offset="60%" stopColor={borderColor} />
                    <stop offset="100%" stopColor="transparent" />
                  </linearGradient>
                </defs>
                {/* Outer glow */}
                <ellipse cx="130" cy="155" rx="126" ry="151"
                  fill="none"
                  stroke={phase === "locked" ? "rgba(34,197,94,0.2)" : "transparent"}
                  strokeWidth="8"
                />
                {/* Spinning arc */}
                <ellipse cx="130" cy="155" rx="126" ry="151"
                  fill="none"
                  stroke="url(#spin-grad)"
                  strokeWidth="3"
                  style={{ transition: "stroke 0.3s ease" }}
                />
                {/* Static outline */}
                <ellipse cx="130" cy="155" rx="126" ry="151"
                  fill="none"
                  stroke={phase === "locked" ? "rgba(34,197,94,0.5)" : "rgba(255,255,255,0.15)"}
                  strokeWidth="1.5"
                  style={{ transition: "stroke 0.3s ease" }}
                />
              </svg>
            </div>

            {/* Countdown circle */}
            {phase === "locked" && (
              <div style={{
                position: "absolute",
                bottom: "12%", left: "50%",
                transform: "translateX(-50%)",
                width: 52, height: 52,
                borderRadius: "50%",
                background: "rgba(34,197,94,0.15)",
                border: "2px solid #22c55e",
                display: "flex", alignItems: "center", justifyContent: "center",
                zIndex: 10,
                boxShadow: "0 0 20px rgba(34,197,94,0.4)",
              }}>
                <span style={{ color: "#22c55e", fontSize: 22, fontWeight: 800 }}>
                  {countdown}
                </span>
              </div>
            )}

            {/* Capture progress dots */}
            {phase === "capturing" && (
              <div style={{
                position: "absolute",
                bottom: "10%", left: "50%",
                transform: "translateX(-50%)",
                display: "flex", gap: 8, zIndex: 10,
                background: "rgba(0,0,0,0.7)",
                padding: "8px 16px", borderRadius: 20,
                backdropFilter: "blur(8px)",
              }}>
                {Array.from({ length: 15 }).map((_, i) => (
                  <div key={i} style={{
                    width: i % 5 === 0 && i > 0 ? 2 : 8,  // thin separator every 5
                    height: i % 5 === 0 && i > 0 ? 16 : 8,
                    borderRadius: i % 5 === 0 && i > 0 ? 1 : "50%",
                    background: i % 5 === 0 && i > 0 ? "#555"
                      : i < captureCount ? "#22c55e" : "#333",
                    boxShadow: i < captureCount && i % 5 !== 0 ? "0 0 6px #22c55e" : "none",
                    transition: "all 0.2s ease",
                  }} />
                ))}
              </div>
            )}

            {/* Loading overlay on camera */}
            {phase === "loading" && (
              <div style={{
                position: "absolute", inset: 0,
                background: "rgba(0,0,0,0.7)",
                display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
                gap: 16, zIndex: 15, backdropFilter: "blur(4px)",
              }}>
                <div style={{
                  width: 180, height: 4, background: "#222", borderRadius: 4, overflow: "hidden",
                }}>
                  <div style={{
                    height: "100%", width: `${loadPct}%`,
                    background: "linear-gradient(90deg,#ff5a5a,#ff8a5a)",
                    borderRadius: 4, transition: "width 0.4s ease",
                  }} />
                </div>
                <p style={{ color: "#aaa", fontSize: 13, margin: 0 }}>{loadMsg}</p>
              </div>
            )}

            {/* Submitting overlay */}
            {phase === "submitting" && (
              <div style={{
                position: "absolute", inset: 0,
                background: "rgba(0,0,0,0.8)",
                display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
                gap: 14, zIndex: 15,
              }}>
                <div style={{
                  width: 36, height: 36,
                  border: "3px solid #333", borderTop: "3px solid #ff5a5a",
                  borderRadius: "50%",
                  animation: "spin 0.8s linear infinite",
                }} />
                <p style={{ color: "#aaa", fontSize: 13, margin: 0 }}>Uploading…</p>
              </div>
            )}
          </div>

          {/* Status */}
          <div style={{ textAlign: "center", marginTop: 20 }}>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              background: "#111", border: `1px solid ${phase === "locked" ? "rgba(34,197,94,0.4)" : "#1f1f1f"}`,
              borderRadius: 20, padding: "8px 18px",
              transition: "border-color 0.3s ease",
              boxShadow: phase === "locked" ? "0 0 16px rgba(34,197,94,0.15)" : "none",
            }}>
              {/* Indicator dot */}
              <div style={{
                width: 8, height: 8, borderRadius: "50%",
                background: phase === "locked" ? "#22c55e" :
                  phase === "loading" ? "#ff8a5a" :
                  isScanning && faceIn ? "#22c55e" : "#555",
                boxShadow: (phase === "locked" || (isScanning && faceIn)) ? "0 0 6px #22c55e" : "none",
                animation: phase === "loading" ? "pulse 1.5s infinite" : "none",
              }} />
              <span style={{
                color: phase === "locked" ? "#22c55e" : "#aaa",
                fontSize: 13, fontWeight: 500,
              }}>
                {statusText}
              </span>
            </div>

            {/* Tips */}
            {isScanning && (
              <div style={{
                display: "flex", gap: 8, justifyContent: "center",
                marginTop: 14, flexWrap: "wrap",
              }}>
                {[["💡", "Good light"], ["👁", "Look straight"], ["📏", "Fill the oval"]].map(([icon, label]) => (
                  <span key={label} style={{
                    background: "#0f0f0f", border: "1px solid #1a1a1a",
                    borderRadius: 8, padding: "4px 10px",
                    color: "#444", fontSize: 12,
                    display: "flex", alignItems: "center", gap: 4,
                  }}>
                    {icon} {label}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
      `}</style>
    </div>
  );
}
