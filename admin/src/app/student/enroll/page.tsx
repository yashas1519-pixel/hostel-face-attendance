"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { fetchWithAuth } from "@/lib/auth";

type Phase = "permission" | "loading" | "detecting" | "capturing" | "submitting" | "done" | "error";

const MODEL_URL =
  "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights";

export default function EnrollPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const scanLineRef = useRef(0);

  const [phase, setPhase] = useState<Phase>("permission");
  const [modelProgress, setModelProgress] = useState(0);
  const [faceDetected, setFaceDetected] = useState(false);
  const [captureCount, setCaptureCount] = useState(0);
  const [flash, setFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoSize, setVideoSize] = useState({ w: 640, h: 480 });

  // ── Step 1: camera starts IMMEDIATELY ────────────────────────────────
  useEffect(() => {
    void startCamera();
    return () => {
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setVideoSize({ w: videoRef.current.videoWidth, h: videoRef.current.videoHeight });
      setPhase("loading");
      void loadModels();
    } catch {
      setError("Camera permission denied — please allow camera access and reload.");
      setPhase("error");
    }
  }

  async function loadModels() {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const faceapi = (await import("face-api.js")) as any;
      setModelProgress(10);
      await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
      setModelProgress(60);
      await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
      setModelProgress(100);
      setPhase("detecting");
      startDetectionLoop(faceapi);
    } catch {
      setError("Failed to load face detection models. Check your internet connection.");
      setPhase("error");
    }
  }

  // ── Detection loop with canvas overlay ────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function startDetectionLoop(faceapi: any) {
    let lastDetect = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let lastDetections: any[] = [];

    const draw = async (ts: number) => {
      const canvas = overlayCanvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      const W = video.videoWidth;
      const H = video.videoHeight;
      if (canvas.width !== W) { canvas.width = W; canvas.height = H; }

      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, W, H);

      // Run face detection every 300ms (not every frame — expensive)
      if (ts - lastDetect > 300) {
        lastDetect = ts;
        lastDetections = await faceapi
          .detectAllFaces(video, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.55 }))
          .withFaceDescriptors();
        setFaceDetected(lastDetections.length === 1);
      }

      // Animated scan line (always drawn)
      scanLineRef.current = (scanLineRef.current + 2) % H;
      const gradient = ctx.createLinearGradient(0, scanLineRef.current - 20, 0, scanLineRef.current + 20);
      gradient.addColorStop(0, "transparent");
      gradient.addColorStop(0.5, lastDetections.length === 1 ? "rgba(34,197,94,0.6)" : "rgba(255,90,90,0.4)");
      gradient.addColorStop(1, "transparent");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, scanLineRef.current - 20, W, 40);

      // Face box + corner brackets
      if (lastDetections.length === 1) {
        const box = lastDetections[0].detection.box;
        const pad = 16;
        const x = box.x - pad, y = box.y - pad;
        const bw = box.width + pad * 2, bh = box.height + pad * 2;

        // Glowing box
        ctx.save();
        ctx.shadowColor = "#22c55e";
        ctx.shadowBlur = 24;
        ctx.strokeStyle = "rgba(34,197,94,0.5)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, bw, bh);
        ctx.restore();

        // Corner brackets
        const cLen = 28;
        ctx.save();
        ctx.strokeStyle = "#22c55e";
        ctx.lineWidth = 4;
        ctx.lineCap = "round";
        ctx.shadowColor = "#22c55e";
        ctx.shadowBlur = 12;
        [
          [x, y + cLen, x, y, x + cLen, y],
          [x + bw - cLen, y, x + bw, y, x + bw, y + cLen],
          [x, y + bh - cLen, x, y + bh, x + cLen, y + bh],
          [x + bw - cLen, y + bh, x + bw, y + bh, x + bw, y + bh - cLen],
        ].forEach(([x1, y1, cx, cy, x2, y2]) => {
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(cx, cy);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        });
        ctx.restore();

        // "Face detected" label
        ctx.save();
        ctx.fillStyle = "rgba(34,197,94,0.85)";
        ctx.roundRect?.(x, y - 28, 130, 22, 6);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "bold 12px Inter, sans-serif";
        ctx.fillText("✓ Face detected", x + 8, y - 11);
        ctx.restore();
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
  }

  // ── Capture 5 frames ────────────────────────────────────────────────
  const captureFrames = useCallback(async () => {
    if (!faceDetected || !videoRef.current) return;
    cancelAnimationFrame(rafRef.current);
    setPhase("capturing");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const faceapi = (await import("face-api.js")) as any;
    const descriptors: Float32Array[] = [];

    for (let i = 0; i < 5; i++) {
      // Flash effect
      setFlash(true);
      await new Promise((r) => setTimeout(r, 120));
      setFlash(false);
      await new Promise((r) => setTimeout(r, 380));

      setCaptureCount(i + 1);

      const result = await faceapi
        .detectSingleFace(videoRef.current!, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
        .withFaceDescriptor();

      if (!result) {
        setError("Face lost during capture — please try again.");
        setPhase("error");
        return;
      }
      descriptors.push(result.descriptor);
    }

    // Average the 5 descriptors
    const avg = new Float32Array(128);
    for (const d of descriptors) d.forEach((v, i) => { avg[i] += v; });
    avg.forEach((_, i) => { avg[i] /= descriptors.length; });

    setPhase("submitting");
    try {
      const res = await fetchWithAuth("/enrollment/submit", {
        method: "POST",
        body: JSON.stringify({ embedding: Array.from(avg) }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(b.message ?? "Submission failed");
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submission failed");
      setPhase("error");
    }
  }, [faceDetected]);

  // ── UI ───────────────────────────────────────────────────────────────
  const showCamera = phase !== "permission" && phase !== "done" && phase !== "error";

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0a0a",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px",
      fontFamily: "'Inter', -apple-system, sans-serif",
    }}>
      <div style={{
        width: "100%",
        maxWidth: 680,
        background: "#111",
        border: "1px solid #1f1f1f",
        borderRadius: 24,
        overflow: "hidden",
        boxShadow: "0 0 80px rgba(255,90,90,0.1)",
      }}>
        {/* Header */}
        <div style={{
          padding: "24px 28px 0",
          textAlign: "center",
        }}>
          <h1 style={{ color: "#fff", fontSize: 22, fontWeight: 700, margin: "0 0 4px" }}>
            Face Enrollment
          </h1>
          <p style={{ color: "#555", fontSize: 13, margin: 0 }}>
            One-time setup · your face is used to verify attendance
          </p>
        </div>

        {/* Camera viewport — always rendered so it starts immediately */}
        <div style={{
          position: "relative",
          margin: "20px 0 0",
          background: "#000",
          display: showCamera ? "block" : "none",
          aspectRatio: "4/3",
          overflow: "hidden",
        }}>
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
              transform: "scaleX(-1)", // mirror for natural feel
            }}
          />
          {/* Canvas overlay for face detection graphics */}
          <canvas
            ref={overlayCanvasRef}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              transform: "scaleX(-1)",
              pointerEvents: "none",
            }}
          />
          {/* Photo flash effect */}
          {flash && (
            <div style={{
              position: "absolute",
              inset: 0,
              background: "rgba(255,255,255,0.85)",
              pointerEvents: "none",
              zIndex: 10,
            }} />
          )}

          {/* Model loading overlay */}
          {phase === "loading" && (
            <div style={{
              position: "absolute",
              inset: 0,
              background: "rgba(10,10,10,0.7)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 16,
              backdropFilter: "blur(4px)",
            }}>
              <div style={{
                width: 200,
                height: 4,
                background: "#1f1f1f",
                borderRadius: 4,
                overflow: "hidden",
              }}>
                <div style={{
                  height: "100%",
                  width: `${modelProgress}%`,
                  background: "linear-gradient(90deg, #ff5a5a, #ff8a5a)",
                  borderRadius: 4,
                  transition: "width 0.5s ease",
                }} />
              </div>
              <p style={{ color: "#aaa", fontSize: 13, margin: 0 }}>
                Loading AI models… {modelProgress}%
              </p>
            </div>
          )}

          {/* Capturing progress overlay */}
          {phase === "capturing" && (
            <div style={{
              position: "absolute",
              bottom: 16,
              left: "50%",
              transform: "translateX(-50%)",
              background: "rgba(10,10,10,0.85)",
              border: "1px solid #333",
              borderRadius: 20,
              padding: "8px 20px",
              backdropFilter: "blur(8px)",
            }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: i < captureCount ? "#22c55e" : "#333",
                    boxShadow: i < captureCount ? "0 0 8px #22c55e" : "none",
                    transition: "all 0.3s ease",
                  }} />
                ))}
                <span style={{ color: "#aaa", fontSize: 12, marginLeft: 4 }}>
                  Frame {captureCount}/5
                </span>
              </div>
            </div>
          )}

          {/* Submitting overlay */}
          {phase === "submitting" && (
            <div style={{
              position: "absolute",
              inset: 0,
              background: "rgba(10,10,10,0.85)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              backdropFilter: "blur(4px)",
            }}>
              <div style={{
                width: 40,
                height: 40,
                border: "3px solid #333",
                borderTop: "3px solid #ff5a5a",
                borderRadius: "50%",
                animation: "spin 1s linear infinite",
              }} />
              <p style={{ color: "#aaa", fontSize: 14, margin: 0 }}>Uploading face data…</p>
            </div>
          )}
        </div>

        {/* Bottom panel */}
        <div style={{ padding: "20px 28px 28px" }}>
          {/* Status text */}
          <p style={{
            color: phase === "error" ? "#ff5a5a" :
              phase === "done" ? "#22c55e" :
              faceDetected ? "#22c55e" : "#666",
            fontSize: 13,
            textAlign: "center",
            marginBottom: 16,
            minHeight: 20,
          }}>
            {phase === "permission" && "Requesting camera access…"}
            {phase === "loading" && "Camera ready — loading face detection AI…"}
            {phase === "detecting" && (faceDetected
              ? "✓ Face detected! Click capture when ready."
              : "Position your face in the frame and hold still")}
            {phase === "capturing" && `Capturing frame ${captureCount} of 5 — hold still…`}
            {phase === "submitting" && "Uploading your face data securely…"}
            {phase === "done" && "✓ Face submitted! Awaiting admin approval."}
            {phase === "error" && (error ?? "Something went wrong")}
          </p>

          {/* Instructions row */}
          {(phase === "detecting" || phase === "capturing") && (
            <div style={{
              display: "flex",
              gap: 10,
              marginBottom: 16,
              justifyContent: "center",
            }}>
              {[
                { icon: "💡", label: "Good lighting" },
                { icon: "👁", label: "Look straight" },
                { icon: "😐", label: "Neutral expression" },
              ].map((tip) => (
                <div key={tip.label} style={{
                  background: "#0f0f0f",
                  border: "1px solid #1f1f1f",
                  borderRadius: 10,
                  padding: "6px 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  color: "#555",
                }}>
                  <span>{tip.icon}</span>
                  <span>{tip.label}</span>
                </div>
              ))}
            </div>
          )}

          {/* Done state */}
          {phase === "done" && (
            <div style={{
              background: "rgba(34,197,94,0.06)",
              border: "1px solid rgba(34,197,94,0.2)",
              borderRadius: 16,
              padding: "16px 20px",
              textAlign: "center",
              marginBottom: 16,
            }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>✅</div>
              <p style={{ color: "#22c55e", fontWeight: 600, margin: "0 0 6px", fontSize: 15 }}>
                Enrollment submitted
              </p>
              <p style={{ color: "#555", fontSize: 12, margin: 0 }}>
                An admin will approve your face within 24 hours.
                Once approved, use the mobile app to mark attendance.
              </p>
            </div>
          )}

          {/* Error state */}
          {phase === "error" && (
            <div style={{
              background: "rgba(255,90,90,0.06)",
              border: "1px solid rgba(255,90,90,0.2)",
              borderRadius: 16,
              padding: "14px 20px",
              textAlign: "center",
              marginBottom: 16,
            }}>
              <p style={{ color: "#ff5a5a", margin: "0 0 12px", fontSize: 14 }}>{error}</p>
              <button
                onClick={() => window.location.reload()}
                style={{
                  background: "#1f1f1f",
                  border: "1px solid #333",
                  borderRadius: 10,
                  color: "#aaa",
                  padding: "8px 20px",
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                Try Again
              </button>
            </div>
          )}

          {/* Action button */}
          {phase === "detecting" && (
            <button
              onClick={() => void captureFrames()}
              disabled={!faceDetected}
              style={{
                width: "100%",
                padding: "15px",
                background: faceDetected
                  ? "linear-gradient(135deg, #ff5a5a, #ff8a5a)"
                  : "#1a1a1a",
                border: faceDetected ? "none" : "1px solid #222",
                borderRadius: 14,
                color: faceDetected ? "#fff" : "#444",
                fontWeight: 700,
                fontSize: 15,
                cursor: faceDetected ? "pointer" : "not-allowed",
                transition: "all 0.3s ease",
                letterSpacing: 0.3,
              }}
            >
              {faceDetected ? "📸  Capture My Face" : "Waiting for face…"}
            </button>
          )}

          {phase === "done" && (
            <button
              onClick={() => router.push("/student")}
              style={{
                width: "100%",
                padding: "15px",
                background: "linear-gradient(135deg, #ff5a5a, #ff8a5a)",
                border: "none",
                borderRadius: 14,
                color: "#fff",
                fontWeight: 700,
                fontSize: 15,
                cursor: "pointer",
              }}
            >
              Go to My Dashboard →
            </button>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
