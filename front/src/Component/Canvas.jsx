import { useRef, useEffect } from "react";

const STORAGE_KEY = "drawing_canvas_data";
const MIN_SCALE = 0.1;
const MAX_SCALE = 8;

export default function Canvas() {
  const canvasRef = useRef(null);

  // viewport: world -> screen is  screen = world*scale + offset
  const viewport = useRef({ scale: 1, x: 0, y: 0 });

  const strokes = useRef([]); // finished strokes: [{ points: [{x,y,width}] }]
  const currentStroke = useRef(null);

  const drawing = useRef(false);
  const pointers = useRef(new Map()); // pointerId -> {x, y}
  const pinch = useRef(null); // { prevDist, prevMid }

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    function redraw() {
      const dpr = window.devicePixelRatio || 1;
      const vp = viewport.current;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

      ctx.setTransform(dpr * vp.scale, 0, 0, dpr * vp.scale, dpr * vp.x, dpr * vp.y);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#04de37";

      const all = currentStroke.current
        ? [...strokes.current, currentStroke.current]
        : strokes.current;

      for (const stroke of all) {
        const pts = stroke.points;
        for (let i = 1; i < pts.length; i++) {
          ctx.lineWidth = pts[i].width;
          ctx.beginPath();
          ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
          ctx.lineTo(pts[i].x, pts[i].y);
          ctx.stroke();
        }
      }
    }

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      redraw();
    }

    function saveCanvas() {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ strokes: strokes.current, viewport: viewport.current })
        );
      } catch {
        // storage unavailable, ignore
      }
    }

    function loadCanvas() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        strokes.current = parsed.strokes || [];
        viewport.current = parsed.viewport || { scale: 1, x: 0, y: 0 };
      } catch {
        // ignore corrupt/missing data
      }
    }

    function getWorldPos(e) {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const vp = viewport.current;
      return {
        x: (sx - vp.x) / vp.scale,
        y: (sy - vp.y) / vp.scale,
        pressure: e.pressure || 0.5,
      };
    }

    function widthFor(pressure) {
      return (1 + pressure * 0) / viewport.current.scale;
    }

    function pinchInfo() {
      const pts = [...pointers.current.values()];
      const [a, b] = pts;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      return { dist, mid };
    }

    function handlePinchMove() {
      const { dist, mid } = pinchInfo();
      const rect = canvas.getBoundingClientRect();
      const midLocal = { x: mid.x - rect.left, y: mid.y - rect.top };
      const vp = viewport.current;
      const p = pinch.current;

      const scaleFactor = dist / p.prevDist;
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, vp.scale * scaleFactor));

      const worldX = (midLocal.x - vp.x) / vp.scale;
      const worldY = (midLocal.y - vp.y) / vp.scale;

      vp.scale = newScale;
      vp.x = midLocal.x - worldX * newScale;
      vp.y = midLocal.y - worldY * newScale;

      p.prevDist = dist;
      p.prevMid = mid;
      redraw();
    }

    function endStroke() {
      if (currentStroke.current) {
        if (currentStroke.current.points.length === 1) {
          const pt = currentStroke.current.points[0];
          currentStroke.current.points.push({ ...pt, x: pt.x + 0.01, y: pt.y + 0.01 });
        }
        strokes.current.push(currentStroke.current);
        currentStroke.current = null;
        saveCanvas();
      }
      drawing.current = false;
    }

    function pointerDown(e) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (e.pointerType === "touch" && pointers.current.size === 2) {
        // second finger down -> switch to pinch, cancel any drawing
        endStroke();
        pinch.current = { ...pinchInfo(), prevDist: pinchInfo().dist, prevMid: pinchInfo().mid };
        return;
      }
      if (e.pointerType === "touch" && pointers.current.size > 2) return;

      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      const p = getWorldPos(e);
      drawing.current = true;
      currentStroke.current = { points: [{ x: p.x, y: p.y, width: widthFor(p.pressure) }] };
    }

    function pointerMove(e) {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.current.size >= 2 && pinch.current) {
        handlePinchMove();
        return;
      }

      if (!drawing.current || !currentStroke.current) return;
      const p = getWorldPos(e);
      currentStroke.current.points.push({ x: p.x, y: p.y, width: widthFor(p.pressure) });
      redraw();
    }

    function pointerUp(e) {
      pointers.current.delete(e.pointerId);

      if (pointers.current.size < 2) {
        pinch.current = null;
      }
      if (drawing.current) {
        endStroke();
        redraw();
      }
    }

    function wheel(e) {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const vp = viewport.current;

      if (e.ctrlKey || e.metaKey) {
        const newScale = Math.min(
          MAX_SCALE,
          Math.max(MIN_SCALE, vp.scale * Math.pow(1.0015, -e.deltaY))
        );
        const worldX = (cx - vp.x) / vp.scale;
        const worldY = (cy - vp.y) / vp.scale;
        vp.scale = newScale;
        vp.x = cx - worldX * newScale;
        vp.y = cy - worldY * newScale;
      } else {
        vp.x -= e.deltaX;
        vp.y -= e.deltaY;
      }
      redraw();
    }

    loadCanvas();
    resize();
    window.addEventListener("resize", resize);
    canvas.addEventListener("wheel", wheel, { passive: false });

    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointerleave", pointerUp);
    canvas.addEventListener("pointercancel", pointerUp);

    return () => {
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointerleave", pointerUp);
      canvas.removeEventListener("pointercancel", pointerUp);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100vw",
        height: "100vh",
        display: "block",
        touchAction: "none",
        background: "#050505",
        cursor: "crosshair",
      }}
    />
  );
}