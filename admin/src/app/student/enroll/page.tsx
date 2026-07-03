"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { fetchWithAuth } from "@/lib/auth";

type Step = "loading" | "detecting" | "capturing" | "submitting" | "done" | "error";

const MODEL_URL =
  "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export default function EnrollPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [step, setStep] = useState<Step>("loading");
  const [statusMsg, setStatusMsg] = useState("Loading face detection models…");
  const [progress, setProgress] = useState(0);
  const [faceDetected, setFaceDetected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load face-api.js dynamically (client-side only, ~6MB models from CDN)
  const loadModels = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const faceapi = (await import("face-api.js")) as any;
    setStatusMsg("Loading face detection model (1/2)…");
    setProgress(20);
    await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
    setStatusMsg("Loading face recognition model (2/2)…");
    setProgress(60);
    await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
    setProgress(90);
    return faceapi;
  }, []);

  const startCamera = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: 640, height: 480 },
    });
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
    }
  }, []);

  useEffect(() => {
    let faceapi: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    let detectionInterval: ReturnType<typeof setInterval>;

    (async () => {
      try {
        faceapi = await loadModels();
        await startCamera();
        setProgress(100);
        setStep("detecting");
        setStatusMsg("Position your face in the frame and hold still");

        // Poll for face detection every 200ms, draw bounding box on canvas
        detectionInterval = setInterval(async () => {
          if (!videoRef.current || !canvasRef.current) return;
          const detections = await faceapi
            .detectAllFaces(videoRef.current, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.6 }))
            .withFaceDescriptors();

          const ctx = canvasRef.current.getContext("2d")!;
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

          const detected = detections.length === 1;
          setFaceDetected(detected);

          if (detected) {
            const box = detections[0].detection.box;
            ctx.strokeStyle = "#22c55e";
            ctx.lineWidth = 3;
            ctx.strokeRect(box.x, box.y, box.width, box.height);
          }
        }, 200);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Camera or model error");
        setStep("error");
      }
    })();

    return () => {
      clearInterval(detectionInterval);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [loadModels, startCamera]);

  const capture = useCallback(async () => {
    if (!videoRef.current || !faceDetected) return;
    setStep("capturing");
    setStatusMsg("Capturing 5 frames for accuracy…");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const faceapi = (await import("face-api.js")) as any;

    const descriptors: Float32Array[] = [];
    for (let i = 0; i < 5; i++) {
      setStatusMsg(`Capturing frame ${i + 1} of 5…`);
      await new Promise((r) => setTimeout(r, 300));
      const result = await faceapi
        .detectSingleFace(videoRef.current, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.6 }))
        .withFaceDescriptor();
      if (!result) throw new Error("Face not detected during capture — try again");
      descriptors.push(result.descriptor);
    }

    // Average the 5 descriptors for a more stable embedding
    const avg = new Float32Array(128);
    for (const d of descriptors) d.forEach((v, i) => { avg[i] += v; });
    avg.forEach((_, i) => { avg[i] /= descriptors.length; });

    const embedding = Array.from(avg);

    setStep("submitting");
    setStatusMsg("Submitting face data for admin approval…");

    const res = await fetchWithAuth("/enrollment/submit", {
      method: "POST",
      body: JSON.stringify({ embedding }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { message?: string };
      throw new Error(body.message ?? "Submission failed");
    }

    streamRef.current?.getTracks().forEach((t) => t.stop());
    setStep("done");
    setStatusMsg("Face submitted! Waiting for admin approval.");
  }, [faceDetected]);

  const handleCapture = async () => {
    try {
      await capture();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setStep("error");
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0a0a",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'Inter', sans-serif",
      padding: "24px",
    }}>
      <div style={{
        width: "100%",
        maxWidth: 560,
        background: "#111",
        border: "1px solid #1f1f1f",
        borderRadius: 24,
        padding: "32px",
        boxShadow: "0 0 60px rgba(255,90,90,0.08)",
      }}>
        {/* Header */}
        <div style={{ marginBottom: 28, textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>👤</div>
          <h1 style={{ color: "#fff", fontSize: 22, fontWeight: 700, margin: 0 }}>
            Face Enrollment
          </h1>
          <p style={{ color: "#666", fontSize: 13, marginTop: 6 }}>
            One-time setup — your face is used to mark attendance
          </p>
        </div>

        {/* Loading progress bar */}
        {step === "loading" && (
          <div style={{ marginBottom: 24 }}>
            <div style={{
              width: "100%", height: 4, background: "#1f1f1f", borderRadius: 4, overflow: "hidden",
            }}>
              <div style={{
                height: "100%",
                width: `${progress}%`,
                background: "linear-gradient(90deg, #ff5a5a, #ff8a5a)",
                borderRadius: 4,
                transition: "width 0.4s ease",
              }} />
            </div>
          </div>
        )}

        {/* Status message */}
        <p style={{
          color: step === "error" ? "#ff5a5a" : "#aaa",
          fontSize: 13,
          textAlign: "center",
          marginBottom: 20,
        }}>
          {error ?? statusMsg}
        </p>

        {/* Camera view */}
        {(step === "detecting" || step === "capturing") && (
          <div style={{ position: "relative", marginBottom: 20, borderRadius: 16, overflow: "hidden" }}>
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              style={{
                width: "100%",
                display: "block",
                borderRadius: 16,
                transform: "scaleX(-1)",
              }}
            />
            <canvas
              ref={canvasRef}
              width={640}
              height={480}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                transform: "scaleX(-1)",
              }}
            />
            {/* Face detection indicator */}
            <div style={{
              position: "absolute",
              top: 12,
              right: 12,
              background: faceDetected ? "rgba(34,197,94,0.2)" : "rgba(255,90,90,0.2)",
              border: `1px solid ${faceDetected ? "#22c55e" : "#ff5a5a"}`,
              borderRadius: 20,
              padding: "4px 12px",
              fontSize: 12,
              color: faceDetected ? "#22c55e" : "#ff5a5a",
              backdropFilter: "blur(8px)",
            }}>
              {faceDetected ? "✓ Face detected" : "No face detected"}
            </div>
          </div>
        )}

        {/* Done state */}
        {step === "done" && (
          <div style={{
            background: "rgba(34,197,94,0.08)",
            border: "1px solid rgba(34,197,94,0.3)",
            borderRadius: 16,
            padding: 24,
            textAlign: "center",
            marginBottom: 20,
          }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
            <p style={{ color: "#22c55e", fontWeight: 600, margin: 0 }}>
              Face submitted for approval
            </p>
            <p style={{ color: "#666", fontSize: 12, marginTop: 8 }}>
              An admin will review and approve your enrollment.
              You will be notified once approved — then you can mark attendance via the mobile app.
            </p>
          </div>
        )}

        {/* Error state */}
        {step === "error" && (
          <div style={{ textAlign: "center", marginBottom: 20 }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: "#1f1f1f",
                border: "1px solid #333",
                borderRadius: 12,
                color: "#aaa",
                padding: "10px 24px",
                cursor: "pointer",
                fontSize: 14,
              }}
            >
              Try Again
            </button>
          </div>
        )}

        {/* Capture button */}
        {step === "detecting" && (
          <button
            onClick={handleCapture}
            disabled={!faceDetected}
            style={{
              width: "100%",
              padding: "14px",
              background: faceDetected
                ? "linear-gradient(135deg, #ff5a5a, #ff8a5a)"
                : "#1f1f1f",
              border: "none",
              borderRadius: 14,
              color: faceDetected ? "#fff" : "#555",
              fontWeight: 700,
              fontSize: 15,
              cursor: faceDetected ? "pointer" : "not-allowed",
              transition: "all 0.3s ease",
            }}
          >
            {faceDetected ? "📸  Capture My Face" : "Waiting for face…"}
          </button>
        )}

        {/* Go to dashboard after done */}
        {step === "done" && (
          <button
            onClick={() => router.push("/student")}
            style={{
              width: "100%",
              padding: "14px",
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
  );
}
