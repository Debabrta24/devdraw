import { useRef, useEffect } from "react";

const STORAGE_KEY = "drawing_canvas_bitmap";

export default function Canvas() {
  const canvasRef = useRef(null);

  const drawing = useRef(false);
  const lastPoint = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    function resize() {
      const dpr = window.devicePixelRatio || 1;

      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;

      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#04de37";
      ctx.lineWidth = 1;

      // Restore saved bitmap
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0, window.innerWidth, window.innerHeight);
        img.src = saved;
      }
    }

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  function saveCanvas() {
    localStorage.setItem(STORAGE_KEY, canvasRef.current.toDataURL("image/png"));
  }

  function getPos(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      pressure: e.pressure || 0.5,
    };
  }

  function pointerDown(e) {
    // Ignore second finger. This prevents drawing with two fingers,
    // but it does NOT implement pinch zoom.
    if (e.pointerType === "touch" && !e.isPrimary) return;

    e.preventDefault();
    canvasRef.current.setPointerCapture(e.pointerId);
    drawing.current = true;
    lastPoint.current = getPos(e);
  }

  function pointerMove(e) {
    if (!drawing.current) return;

    const ctx = canvasRef.current.getContext("2d");
    const p = getPos(e);

    ctx.lineWidth = 3 + p.pressure * 1.2;

    ctx.beginPath();
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();

    lastPoint.current = p;
  }

  function pointerUp() {
    if (drawing.current) saveCanvas();
    drawing.current = false;
    lastPoint.current = null;
  }

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerLeave={pointerUp}
      onPointerCancel={pointerUp}
      style={{
        width: "100vw",
        height: "100vh",
        display: "block",
        touchAction: "none",
        background: "#fff",
        cursor: "crosshair",
      }}
    />
  );
}
