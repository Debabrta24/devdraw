import { useRef, useEffect, useState } from "react";
import Header from "./Header";
const STROKES_KEY = "drawing_canvas_strokes";
const VIEW_KEY = "drawing_canvas_view";
const SAVE_DEBOUNCE_MS = 300;

export default function Canvas() {
  const canvasRef = useRef(null);
  const rectRef = useRef({ left: 0, top: 0 });

  const strokes = useRef([]); // {points:[{x,y,pressure}], color}
  const currentStroke = useRef(null);

  const view = useRef({ x: 0, y: 0, scale: 1 }); // screen = world*scale + offset

  const drawing = useRef(false);
  const activePointers = useRef(new Map()); // pointerId -> {x,y}
  const pinch = useRef(null);

  const dirty = useRef(true);

  const [bgColor, setBgcolor] = useState("blue");
  const [linecolor, setLinecolor] = useState("green");
  const [lineWidth, setLinewidth] = useState(2);
  // Refs mirroring the color state so the render loop (set up once in the
  // effect below) always reads the *current* colors instead of the values
  // captured at mount time.
  const bgColorRef = useRef(bgColor);
  const lineColorRef = useRef(linecolor);
  const linewidthRef = useRef(lineWidth);

  useEffect(() => {
    bgColorRef.current = bgColor;
    dirty.current = true; // force a repaint so the new bg shows immediately
  }, [bgColor]);

  useEffect(() => {
    lineColorRef.current = linecolor;
  }, [linecolor]);

  useEffect(() => {
    linewidthRef.current = lineWidth;
  }, [lineWidth]);
  // Lock the page down so mobile browsers don't hijack pinch/scroll
  // gestures before they reach the canvas.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;

    const prev = {
      htmlTouch: html.style.touchAction,
      bodyTouch: body.style.touchAction,
      bodyOverflow: body.style.overflow,
      bodyMargin: body.style.margin,
      bodyOverscroll: body.style.overscrollBehavior,
      htmlOverscroll: html.style.overscrollBehavior,
    };

    html.style.touchAction = "none";
    body.style.touchAction = "none";
    body.style.overflow = "hidden";
    body.style.margin = "0";
    body.style.overscrollBehavior = "none";
    html.style.overscrollBehavior = "none";

    // Force the viewport meta to disable native pinch-zoom, so gestures
    // are handled by our own pointer logic instead of the browser.
    let meta = document.querySelector('meta[name="viewport"]');
    let createdMeta = false;
    const prevMetaContent = meta ? meta.getAttribute("content") : null;
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "viewport";
      document.head.appendChild(meta);
      createdMeta = true;
    }
    meta.setAttribute(
      "content",
      "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no",
    );

    return () => {
      html.style.touchAction = prev.htmlTouch;
      body.style.touchAction = prev.bodyTouch;
      body.style.overflow = prev.bodyOverflow;
      body.style.margin = prev.bodyMargin;
      body.style.overscrollBehavior = prev.bodyOverscroll;
      html.style.overscrollBehavior = prev.htmlOverscroll;
      if (createdMeta) {
        meta.remove();
      } else if (prevMetaContent !== null) {
        meta.setAttribute("content", prevMetaContent);
      }
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let rafId;
    let saveStrokesTimer = null;
    let saveViewTimer = null;

    function markDirty() {
      dirty.current = true;
    }

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      rectRef.current = canvas.getBoundingClientRect();
      markDirty();
    }

    function render() {
      rafId = requestAnimationFrame(render);
      if (!dirty.current) return;
      dirty.current = false;

      const dpr = window.devicePixelRatio || 1;
      const { x, y, scale } = view.current;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = bgColorRef.current;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, x * dpr, y * dpr);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      const all = currentStroke.current
        ? [...strokes.current, currentStroke.current]
        : strokes.current;

      for (const s of all) {
        const pts = s.points;
        if (pts.length < 2) continue;
        ctx.strokeStyle = s.color;
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1];
          const b = pts[i];
          ctx.lineWidth = (linewidthRef.current/2)+b.pressure * 0.1;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    // Debounced saves so fast gestures (wheel zoom, pinch, drawing)
    // never block the main thread with synchronous localStorage writes.
    function saveStrokes() {
      clearTimeout(saveStrokesTimer);
      saveStrokesTimer = setTimeout(() => {
        try {
          localStorage.setItem(STROKES_KEY, JSON.stringify(strokes.current));
        } catch {}
      }, SAVE_DEBOUNCE_MS);
    }

    function saveView() {
      clearTimeout(saveViewTimer);
      saveViewTimer = setTimeout(() => {
        try {
          localStorage.setItem(VIEW_KEY, JSON.stringify(view.current));
        } catch {}
      }, SAVE_DEBOUNCE_MS);
    }

    // restore
    try {
      const savedStrokes = localStorage.getItem(STROKES_KEY);
      if (savedStrokes) strokes.current = JSON.parse(savedStrokes);
      const savedView = localStorage.getItem(VIEW_KEY);
      if (savedView) view.current = JSON.parse(savedView);
    } catch {}

    resize();
    window.addEventListener("resize", resize);
    rafId = requestAnimationFrame(render);

    function toWorld(sx, sy) {
      const { x, y, scale } = view.current;
      return { x: (sx - x) / scale, y: (sy - y) / scale };
    }

    function getScreenPos(e) {
      const rect = rectRef.current;
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        pressure: e.pressure || 0.5,
      };
    }

    function dist(p1, p2) {
      return Math.hypot(p1.x - p2.x, p1.y - p2.y);
    }

    function midpoint(p1, p2) {
      return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    }

    function startPinch() {
      const pts = [...activePointers.current.values()];
      pinch.current = {
        startDist: dist(pts[0], pts[1]),
        startScale: view.current.scale,
        startMid: midpoint(pts[0], pts[1]),
        startViewX: view.current.x,
        startViewY: view.current.y,
      };
    }

    function endCurrentStroke() {
      if (currentStroke.current && currentStroke.current.points.length > 1) {
        strokes.current.push(currentStroke.current);
        saveStrokes();
      }
      currentStroke.current = null;
      drawing.current = false;
      markDirty();
    }

    function pointerDown(e) {
      canvas.setPointerCapture(e.pointerId);
      const pos = getScreenPos(e);
      activePointers.current.set(e.pointerId, pos);

      if (activePointers.current.size === 1) {
        e.preventDefault();
        drawing.current = true;
        const w = toWorld(pos.x, pos.y);
        currentStroke.current = {
          color: lineColorRef.current,
          points: [{ x: w.x, y: w.y, pressure: pos.pressure }],
        };
        markDirty();
      } else if (activePointers.current.size === 2) {
        e.preventDefault();
        endCurrentStroke();
        startPinch();
      }
    }

    function pointerMove(e) {
      if (!activePointers.current.has(e.pointerId)) return;
      e.preventDefault();
      const pos = getScreenPos(e);
      activePointers.current.set(e.pointerId, pos);

      if (activePointers.current.size >= 2 && pinch.current) {
        const pts = [...activePointers.current.values()];
        const d = dist(pts[0], pts[1]);
        const mid = midpoint(pts[0], pts[1]);
        const scaleFactor = d / pinch.current.startDist;
        const newScale = Math.min(
          Math.max(pinch.current.startScale * scaleFactor, 0.1),
          20,
        );

        const worldX =
          (pinch.current.startMid.x - pinch.current.startViewX) /
          pinch.current.startScale;
        const worldY =
          (pinch.current.startMid.y - pinch.current.startViewY) /
          pinch.current.startScale;

        view.current.scale = newScale;
        view.current.x = mid.x - worldX * newScale;
        view.current.y = mid.y - worldY * newScale;
        markDirty();
        saveView();
      } else if (drawing.current && currentStroke.current) {
        const w = toWorld(pos.x, pos.y);
        currentStroke.current.points.push({
          x: w.x,
          y: w.y,
          pressure: pos.pressure,
        });
        markDirty();
      }
    }

    function pointerUp(e) {
      activePointers.current.delete(e.pointerId);

      if (activePointers.current.size < 2 && pinch.current) {
        pinch.current = null;
        saveView();
      }
      if (activePointers.current.size === 0 && drawing.current) {
        endCurrentStroke();
      }
      if (activePointers.current.size === 1 && pinch.current === null) {
        // one finger left after a pinch — don't resume drawing from it
        drawing.current = false;
        currentStroke.current = null;
      }
    }

    function wheel(e) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = rectRef.current;
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const factor = Math.exp(-e.deltaY * 0.01);
        const newScale = Math.min(
          Math.max(view.current.scale * factor, 0.1),
          20,
        );
        const worldX = (sx - view.current.x) / view.current.scale;
        const worldY = (sy - view.current.y) / view.current.scale;
        view.current.scale = newScale;
        view.current.x = sx - worldX * newScale;
        view.current.y = sy - worldY * newScale;
      } else {
        view.current.x -= e.deltaX;
        view.current.y -= e.deltaY;
      }
      markDirty();
      saveView();
    }

    canvas.addEventListener("pointerdown", pointerDown, { passive: false });
    canvas.addEventListener("pointermove", pointerMove, { passive: false });
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointercancel", pointerUp);
    canvas.addEventListener("pointerleave", pointerUp);
    canvas.addEventListener("wheel", wheel, { passive: false });

    return () => {
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointercancel", pointerUp);
      canvas.removeEventListener("pointerleave", pointerUp);
      canvas.removeEventListener("wheel", wheel);
      cancelAnimationFrame(rafId);
      clearTimeout(saveStrokesTimer);
      clearTimeout(saveViewTimer);
    };
  }, []);

  const sentValu = (value) => {
    console.log(value);
    setBgcolor(value.backgroundColor);
    setLinecolor(value.fillColor);
    setLinewidth(value.stockWidth);
  };

  return (
    <>
      <Header sentValu={sentValu} />
      <canvas
        ref={canvasRef}
        style={{
          width: "100vw",
          height: "100vh",
          display: "block",
          touchAction: "none",
          background: "#a5a5a5",
          cursor: "mouse",
        }}
      />
    </>
  );
}
