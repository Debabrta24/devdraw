import { useRef, useEffect, useState } from "react";
import Header from "./Header";
const STROKES_KEY = "drawing_canvas_strokes";
const VIEW_KEY = "drawing_canvas_view";
const SAVE_DEBOUNCE_MS = 300;

function cursorForTool(tool, isPanning) {
  switch (tool) {
    case "hand":
      return isPanning ? "grabbing" : "grab";
    case "cursor":
      return "default";
    case "text":
      return "text";
    case "eraser":
      return "cell";
    case "pencil":
    case "rectangle":
    case "circle":
    case "line":
    case "arrow":
      return "crosshair";
    default:
      return "crosshair";
  }
}

function dist(p1, p2) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function midpoint(p1, p2) {
  return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
}

function pointToSegDist(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

// used both by the eraser (find what's under the pointer) and the
// cursor/select tool (find what got clicked)
function hitTestStroke(p, s, threshold) {
  const type = s.type || "pencil";

  if (type === "pencil") {
    for (let i = 1; i < s.points.length; i++) {
      if (pointToSegDist(p, s.points[i - 1], s.points[i]) <= threshold) return true;
    }
    return false;
  }

  const [a, b] = s.points;

  if (type === "rectangle") {
    const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
    const y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
    const corners = [
      { x: x1, y: y1 },
      { x: x2, y: y1 },
      { x: x2, y: y2 },
      { x: x1, y: y2 },
    ];
    for (let i = 0; i < 4; i++) {
      if (pointToSegDist(p, corners[i], corners[(i + 1) % 4]) <= threshold) return true;
    }
    return false;
  }

  if (type === "circle") {
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    const rx = Math.max(Math.abs(b.x - a.x) / 2, 1);
    const ry = Math.max(Math.abs(b.y - a.y) / 2, 1);
    const val = Math.pow((p.x - cx) / rx, 2) + Math.pow((p.y - cy) / ry, 2);
    return Math.abs(val - 1) <= 0.25;
  }

  // line + arrow
  return pointToSegDist(p, a, b) <= threshold;
}

function boundsOf(s) {
  const xs = s.points.map((p) => p.x);
  const ys = s.points.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function drawStroke(ctx, s) {
  const type = s.type || "pencil";
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.width;

  if (type === "pencil") {
    const pts = s.points;
    if (pts.length < 2) return;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      ctx.lineWidth = s.width / 2 + (b.pressure || 0.5) * 0.1; //width of strok
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    return;
  }

  const [a, b] = s.points;

  if (type === "rectangle") {
    ctx.strokeRect(
      Math.min(a.x, b.x),
      Math.min(a.y, b.y),
      Math.abs(b.x - a.x),
      Math.abs(b.y - a.y),
    );
  } else if (type === "circle") {
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    const rx = Math.abs(b.x - a.x) / 2;
    const ry = Math.abs(b.y - a.y) / 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (type === "line") {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  } else if (type === "arrow") {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const headLen = 10 + s.width;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(
      b.x - headLen * Math.cos(angle - Math.PI / 6),
      b.y - headLen * Math.sin(angle - Math.PI / 6),
    );
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(
      b.x - headLen * Math.cos(angle + Math.PI / 6),
      b.y - headLen * Math.sin(angle + Math.PI / 6),
    );
    ctx.stroke();
  }
}

export default function Canvas() {
  const canvasRef = useRef(null);
  const rectRef = useRef({ left: 0, top: 0 });
  const strokes = useRef([]); // pencil strokes + shapes, all live here now
  const currentStroke = useRef(null);
  const view = useRef({ x: 0, y: 0, scale: 1 }); // screen = world*scale + offset
  const drawing = useRef(false);
  const activePointers = useRef(new Map()); // pointerId -> {x,y}
  const pinch = useRef(null);
  const dirty = useRef(true);

  // hand tool panning
  const panRef = useRef(null);

  // eraser
  const erasing = useRef(false);

  // cursor / select tool
  const selectedIndex = useRef(-1);
  const dragging = useRef(false);
  const dragOrigin = useRef(null);
  const originalPoints = useRef(null);

  const [bgColor, setBgcolor] = useState("Black");
  const [linecolor, setLinecolor] = useState("green");
  const [lineWidth, setLinewidth] = useState(6);
  const [tool, setTool] = useState("pencil");
  const [isPanning, setIsPanning] = useState(false);

  // refs mirroring state so the render/pointer loop (set up once below)
  // always reads current values instead of what was captured at mount
  const bgColorRef = useRef(bgColor);
  const lineColorRef = useRef(linecolor);
  const linewidthRef = useRef(lineWidth);
  const toolRef = useRef(tool);

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

  useEffect(() => {
    toolRef.current = tool;
    // switching tools mid-drag would be weird, so drop any select state
    if (tool !== "cursor") {
      selectedIndex.current = -1;
      dirty.current = true;
    }
  }, [tool]);

  const cursorStyle = cursorForTool(tool, isPanning);

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
        drawStroke(ctx, s);
      }

      if (toolRef.current === "cursor" && selectedIndex.current >= 0) {
        const s = strokes.current[selectedIndex.current];
        if (s) {
          const b = boundsOf(s);
          const pad = 6 / scale;
          ctx.save();
          ctx.setLineDash([6 / scale, 4 / scale]);
          ctx.strokeStyle = "#3b82f6";
          ctx.lineWidth = 1.5 / scale;
          ctx.strokeRect(
            b.minX - pad,
            b.minY - pad,
            b.maxX - b.minX + pad * 2,
            b.maxY - b.minY + pad * 2,
          );
          ctx.restore();
        }
      }
    }

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
      const s = currentStroke.current;
      if (s) {
        if (s.type === "pencil") {
          if (s.points.length > 1) {
            strokes.current.push(s);
            saveStrokes();
          }
        } else {
          // shape tool - ignore basically-zero-size shapes (accidental taps)
          const [a, b] = s.points;
          if (Math.abs(a.x - b.x) > 1 || Math.abs(a.y - b.y) > 1) {
            strokes.current.push(s);
            saveStrokes();
          }
        }
      }
      currentStroke.current = null;
      drawing.current = false;
      markDirty();
    }

    function eraseAt(w) {
      const threshold = (10 + linewidthRef.current) / view.current.scale;
      const before = strokes.current.length;
      strokes.current = strokes.current.filter(
        (s) => !hitTestStroke(w, s, threshold),
      );
      if (strokes.current.length !== before) markDirty();
    }

    function pointerDown(e) {
      canvas.setPointerCapture(e.pointerId);
      const pos = getScreenPos(e);
      activePointers.current.set(e.pointerId, pos);

      if (activePointers.current.size === 2) {
        e.preventDefault();
        endCurrentStroke();
        startPinch();
        return;
      }

      if (activePointers.current.size !== 1) return;
      e.preventDefault();

      const currentTool = toolRef.current;
      const w = toWorld(pos.x, pos.y);

      if (currentTool === "hand") {
        panRef.current = {
          sx: pos.x,
          sy: pos.y,
          vx: view.current.x,
          vy: view.current.y,
        };
        setIsPanning(true);
        return;
      }

      if (currentTool === "eraser") {
        erasing.current = true;
        eraseAt(w);
        return;
      }

      if (currentTool === "cursor") {
        const threshold = 10 / view.current.scale;
        let hitIndex = -1;
        for (let i = strokes.current.length - 1; i >= 0; i--) {
          if (hitTestStroke(w, strokes.current[i], threshold)) {
            hitIndex = i;
            break;
          }
        }
        selectedIndex.current = hitIndex;
        if (hitIndex >= 0) {
          dragOrigin.current = w;
          originalPoints.current = strokes.current[hitIndex].points.map((p) => ({
            ...p,
          }));
          dragging.current = true;
        }
        markDirty();
        return;
      }

      if (currentTool === "text") {
        // text tool placeholder - not wired up to an editor yet
        return;
      }

      if (currentTool === "pencil") {
        drawing.current = true;
        currentStroke.current = {
          type: "pencil",
          color: lineColorRef.current,
          width: linewidthRef.current,
          points: [{ x: w.x, y: w.y, pressure: pos.pressure }],
        };
        markDirty();
        return;
      }

      // rectangle / circle / line / arrow
      drawing.current = true;
      currentStroke.current = {
        type: currentTool,
        color: lineColorRef.current,
        width: linewidthRef.current,
        points: [
          { x: w.x, y: w.y },
          { x: w.x, y: w.y },
        ],
      };
      markDirty();
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
        return;
      }

      const currentTool = toolRef.current;
      const w = toWorld(pos.x, pos.y);

      if (currentTool === "hand" && panRef.current) {
        view.current.x = panRef.current.vx + (pos.x - panRef.current.sx);
        view.current.y = panRef.current.vy + (pos.y - panRef.current.sy);
        markDirty();
        saveView();
        return;
      }

      if (currentTool === "eraser" && erasing.current) {
        eraseAt(w);
        return;
      }

      if (currentTool === "cursor" && dragging.current && selectedIndex.current >= 0) {
        const dx = w.x - dragOrigin.current.x;
        const dy = w.y - dragOrigin.current.y;
        const s = strokes.current[selectedIndex.current];
        if (s) {
          s.points = originalPoints.current.map((p) => ({
            ...p,
            x: p.x + dx,
            y: p.y + dy,
          }));
          markDirty();
        }
        return;
      }

      if (drawing.current && currentStroke.current) {
        if (currentStroke.current.type === "pencil") {
          currentStroke.current.points.push({
            x: w.x,
            y: w.y,
            pressure: pos.pressure,
          });
        } else {
          currentStroke.current.points[1] = { x: w.x, y: w.y };
        }
        markDirty();
      }
    }

    function pointerUp(e) {
      activePointers.current.delete(e.pointerId);

      if (activePointers.current.size < 2 && pinch.current) {
        pinch.current = null;
        saveView();
      }

      if (activePointers.current.size === 0) {
        if (drawing.current) endCurrentStroke();
        if (panRef.current) {
          panRef.current = null;
          setIsPanning(false);
          saveView();
        }
        if (erasing.current) {
          erasing.current = false;
          saveStrokes();
        }
        if (dragging.current) {
          dragging.current = false;
          saveStrokes();
        }
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

    function keyDown(e) {
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        toolRef.current === "cursor" &&
        selectedIndex.current >= 0
      ) {
        strokes.current.splice(selectedIndex.current, 1);
        selectedIndex.current = -1;
        saveStrokes();
        markDirty();
      }
    }

    canvas.addEventListener("pointerdown", pointerDown, { passive: false });
    canvas.addEventListener("pointermove", pointerMove, { passive: false });
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointercancel", pointerUp);
    canvas.addEventListener("pointerleave", pointerUp);
    canvas.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("keydown", keyDown);

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", keyDown);
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
    setBgcolor(value.backgroundColor);
    setLinecolor(value.fillColor);
    setLinewidth(value.stockWidth);
    setTool(value.selectedTool);
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
          cursor: cursorStyle,
        }}
      />
    </>
  );
}