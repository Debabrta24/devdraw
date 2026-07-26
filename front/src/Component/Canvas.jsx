import { useRef, useEffect, useState } from "react";
import { io } from "socket.io-client";
import Header from "./Header";
import RoomBar from "./RoomBar";

function drawRemoteCursor(ctx, c, scale) {
  if (!c || c.x == null || c.y == null) return;
  const size = 12 / scale;
  ctx.save();
  ctx.fillStyle = c.color || "#3b82f6";
  ctx.beginPath();
  ctx.arc(c.x, c.y, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5 / scale;
  ctx.stroke();

  ctx.fillStyle = c.color || "#3b82f6";
  ctx.font = `600 ${Math.max(10, 12 / scale)}px sans-serif`;
  ctx.fillText(c.name || "User", c.x + size, c.y + size / 2);
  ctx.restore();
}
const STROKES_KEY = "drawing_canvas_strokes";
const VIEW_KEY = "drawing_canvas_view";
const SAVE_DEBOUNCE_MS = 300;
const TEXT_FONT_SIZE = 20;
const HISTORY_LIMIT = 50;
const TAP_WINDOW_MS = 350;
const TAP_MOVE_THRESHOLD = 25;

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
    case "image":
      return "copy";
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

function cornerPoint(b, role) {
  if (role === "tl") return { x: b.minX, y: b.minY };
  if (role === "tr") return { x: b.maxX, y: b.minY };
  if (role === "bl") return { x: b.minX, y: b.maxY };
  return { x: b.maxX, y: b.maxY }; // br
}

const OPPOSITE_CORNER = { tl: "br", tr: "bl", bl: "tr", br: "tl" };

// used both by the eraser (find what's under the pointer) and the
// cursor/select tool (find what got clicked). For cursor, images are
// treated as solid boxes. For eraser, non-image strokes are prioritized so
// erasing doodles on top of a photo doesn't wipe the background photo.
function hitTestStroke(p, s, threshold, isEraser = false) {
  const type = s.type || "pencil";

  if (type === "pencil") {
    for (let i = 1; i < s.points.length; i++) {
      if (pointToSegDist(p, s.points[i - 1], s.points[i]) <= threshold) return true;
    }
    return false;
  }

  const [a, b] = s.points;

  if (type === "rectangle" || (type === "image" && isEraser)) {
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

  if (type === "text" || (type === "image" && !isEraser)) {
    const x1 = Math.min(a.x, b.x) - threshold;
    const x2 = Math.max(a.x, b.x) + threshold;
    const y1 = Math.min(a.y, b.y) - threshold;
    const y2 = Math.max(a.y, b.y) + threshold;
    return p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2;
  }

  // line + arrow
  return pointToSegDist(p, a, b) <= threshold;
}

function getHandles(s) {
  const type = s.type || "pencil";
  if (type === "pencil") {
    const b = boundsOf(s);
    return ["tl", "tr", "bl", "br"].map((role) => ({ role, ...cornerPoint(b, role) }));
  }
  const [a, b] = s.points;
  return [
    { role: "a", x: a.x, y: a.y },
    { role: "b", x: b.x, y: b.y },
  ];
}

function drawStroke(ctx, s, helpers) {
  const type = s.type || "pencil";

  if (type === "image") {
    const img = helpers.getImage(s.src);
    if (!img) return; // still loading, next frame picks it up once markDirty fires
    const [a, b] = s.points;
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    ctx.drawImage(img, x, y, w, h);
    return;
  }

  if (type === "text") {
    const [a, b] = s.points;
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const h = Math.abs(b.y - a.y) || TEXT_FONT_SIZE;
    const lines = (s.text || "").split("\n");
    const fontSize = Math.max(8, h / lines.length);
    ctx.fillStyle = s.color;
    ctx.font = fontSize + "px sans-serif";
    ctx.textBaseline = "top";
    lines.forEach((line, i) => ctx.fillText(line, x, y + i * fontSize * 1.15));
    return;
  }

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
  const strokes = useRef([]); // pencil strokes + shapes + text + images, all live here
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
  const resizing = useRef(null); // {index, role, originalPoints}

  // text tool
  const pendingTextRef = useRef(null); // {worldX, worldY} set when the editor opens
  const textAreaRef = useRef(null);
  const commitTextEditorRef = useRef(null);
  const cancelTextEditorRef = useRef(null);
  const [textEditor, setTextEditor] = useState(null); // {left, top} in screen coords, or null

  // image tool
  const imageCacheRef = useRef(new Map()); // src -> loaded HTMLImageElement
  const lastFileRef = useRef(null);
  const [file, setFile] = useState(null);

  // double/triple tap tracking
  const tapRef = useRef({ count: 0, timer: null, lastX: -9999, lastY: -9999, lastTime: 0 });
  const pointerDownTimes = useRef(new Map()); // pointerId -> {x,y,time}, used to tell a tap from a drag

  // undo / redo history — snapshots of the whole strokes array
  const historyRef = useRef([]);
  const historyIndexRef = useRef(-1);

  const urlParams = new URLSearchParams(window.location.search);
  const initialRoom = urlParams.get("room") || "room-1";

  const [roomId, setRoomId] = useState(initialRoom);
  const [isConnected, setIsConnected] = useState(false);
  const [userCount, setUserCount] = useState(1);

  const roomIdRef = useRef(roomId);
  const isConnectedRef = useRef(isConnected);
  const socketRef = useRef(null);
  const remoteLiveStrokes = useRef(new Map());
  const remoteCursors = useRef(new Map());

  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  useEffect(() => {
    isConnectedRef.current = isConnected;
  }, [isConnected]);

  useEffect(() => {
    const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:4000";
    const socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setIsConnected(true);
      if (roomIdRef.current) {
        socket.emit("join-room", roomIdRef.current);
      }
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
    });

    socket.on("init-room", (data) => {
      if (data && Array.isArray(data.strokes)) {
        strokes.current = data.strokes;
        snapshotHistory();
        dirty.current = true;
      }
    });

    socket.on("stroke:add", (stroke) => {
      if (stroke) {
        strokes.current.push(stroke);
        snapshotHistory();
        dirty.current = true;
      }
    });

    socket.on("stroke:live", ({ userId, stroke }) => {
      if (userId && stroke) {
        remoteLiveStrokes.current.set(userId, stroke);
        dirty.current = true;
      }
    });

    socket.on("strokes:sync", (syncedStrokes) => {
      if (Array.isArray(syncedStrokes)) {
        strokes.current = syncedStrokes;
        snapshotHistory();
        dirty.current = true;
      }
    });

    socket.on("cursor:move", (data) => {
      if (data && data.id) {
        remoteCursors.current.set(data.id, data);
        dirty.current = true;
      }
    });

    socket.on("room-users-update", (data) => {
      if (data && typeof data.count === "number") {
        setUserCount(data.count);
      }
    });

    socket.on("user-left", (userId) => {
      remoteCursors.current.delete(userId);
      remoteLiveStrokes.current.delete(userId);
      dirty.current = true;
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const handleJoinRoom = (newRoomId) => {
    setRoomId(newRoomId);
    roomIdRef.current = newRoomId;
    window.history.replaceState(null, "", `?room=${encodeURIComponent(newRoomId)}`);
    remoteLiveStrokes.current.clear();
    remoteCursors.current.clear();
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit("join-room", newRoomId);
    }
  };

  const handleGenerateRoom = () => {
    return `room-${Math.random().toString(36).substring(2, 8)}`;
  };

  function syncStrokesToSocket() {
    if (socketRef.current && isConnectedRef.current && roomIdRef.current) {
      socketRef.current.emit("strokes:sync", {
        roomId: roomIdRef.current,
        strokes: strokes.current,
      });
    }
  }

  function emitAddedStroke(stroke) {
    if (socketRef.current && isConnectedRef.current && roomIdRef.current && stroke) {
      socketRef.current.emit("stroke:add", {
        roomId: roomIdRef.current,
        stroke,
      });
    }
  }

  function emitLiveStroke(stroke) {
    if (socketRef.current && isConnectedRef.current && roomIdRef.current && stroke) {
      socketRef.current.emit("stroke:live", {
        roomId: roomIdRef.current,
        stroke,
      });
    }
  }

  function emitCursorMove(worldPos) {
    if (socketRef.current && isConnectedRef.current && roomIdRef.current && worldPos) {
      socketRef.current.emit("cursor:move", {
        roomId: roomIdRef.current,
        cursor: { x: worldPos.x, y: worldPos.y },
      });
    }
  }

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

  function snapshotHistory() {
    const snap = JSON.stringify(strokes.current);
    if (historyRef.current.length && historyRef.current[historyIndexRef.current] === snap) {
      return; // nothing actually changed, don't waste a history slot
    }
    // if we're mid-stack (user undid a few times, then did something new),
    // drop the redo branch that's now stale
    historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    historyRef.current.push(snap);
    if (historyRef.current.length > HISTORY_LIMIT) {
      historyRef.current.shift();
    }
    historyIndexRef.current = historyRef.current.length - 1;
  }

  function persistStrokes() {
    try {
      localStorage.setItem(STROKES_KEY, JSON.stringify(strokes.current));
    } catch {}
  }

  function undo() {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    strokes.current = JSON.parse(historyRef.current[historyIndexRef.current]);
    selectedIndex.current = -1;
    dirty.current = true;
    persistStrokes();
    syncStrokesToSocket();
  }

  function redo() {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    strokes.current = JSON.parse(historyRef.current[historyIndexRef.current]);
    selectedIndex.current = -1;
    dirty.current = true;
    persistStrokes();
    syncStrokesToSocket();
  }

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

  // keep the textarea focused the moment it appears
  useEffect(() => {
    if (textEditor && textAreaRef.current) {
      textAreaRef.current.focus();
    }
  }, [textEditor]);

  // watch for a newly picked photo from the header and drop it on the canvas
  useEffect(() => {
    if (!file || file === lastFileRef.current) return;
    lastFileRef.current = file;
    if (!file.type || !file.type.startsWith("image/")) return; // pdfs etc aren't rendered here

    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result;
      const img = new Image();
      img.onload = () => {
        imageCacheRef.current.set(src, img);

        const canvas = canvasRef.current;
        const screenCenterX = canvas ? canvas.clientWidth / 2 : 400;
        const screenCenterY = canvas ? canvas.clientHeight / 2 : 300;
        const { x, y, scale } = view.current;
        const worldCenterX = (screenCenterX - x) / scale;
        const worldCenterY = (screenCenterY - y) / scale;

        const maxDim = 320; // don't dump a giant photo straight onto the canvas
        const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = img.width * ratio;
        const h = img.height * ratio;

        strokes.current.push({
          type: "image",
          src,
          points: [
            { x: worldCenterX - w / 2, y: worldCenterY - h / 2 },
            { x: worldCenterX + w / 2, y: worldCenterY + h / 2 },
          ],
        });
        selectedIndex.current = strokes.current.length - 1;
        dirty.current = true;
        setTool("cursor"); // so the resize handles are right there waiting

        persistStrokes();
        snapshotHistory();
        emitAddedStroke(strokes.current[strokes.current.length - 1]);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  }, [file]);

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

    function getImage(src) {
      let img = imageCacheRef.current.get(src);
      if (!img) {
        img = new Image();
        img.onload = () => {
          dirty.current = true; // repaint once it's actually ready to draw
        };
        img.src = src;
        imageCacheRef.current.set(src, img);
      }
      return img.complete && img.naturalWidth > 0 ? img : null;
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

      const helpers = { getImage };
      const all = currentStroke.current
        ? [...strokes.current, currentStroke.current]
        : strokes.current;

      for (const s of all) {
        drawStroke(ctx, s, helpers);
      }

      // Draw remote live strokes from other connected users
      for (const remoteStroke of remoteLiveStrokes.current.values()) {
        if (remoteStroke) {
          drawStroke(ctx, remoteStroke, helpers);
        }
      }

      // Draw remote cursors from other connected users
      for (const userCursor of remoteCursors.current.values()) {
        drawRemoteCursor(ctx, userCursor, scale);
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
          ctx.setLineDash([]);
          ctx.fillStyle = "#3b82f6";
          const hs = 5 / scale; // handle half-size, kept constant in screen pixels
          for (const h of getHandles(s)) {
            ctx.fillRect(h.x - hs, h.y - hs, hs * 2, hs * 2);
          }
          ctx.restore();
        }
      }
    }

    // Debounced saves so fast gestures (wheel zoom, pinch, drawing)
    // never block the main thread with synchronous localStorage writes.
    function saveStrokes() {
      clearTimeout(saveStrokesTimer);
      saveStrokesTimer = setTimeout(() => {
        persistStrokes();
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

    // seed undo history with whatever we just loaded (or an empty canvas)
    historyRef.current = [JSON.stringify(strokes.current)];
    historyIndexRef.current = 0;

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
            snapshotHistory();
            emitAddedStroke(s);
          }
        } else {
          // shape tool - ignore basically-zero-size shapes (accidental taps)
          const [a, b] = s.points;
          if (Math.abs(a.x - b.x) > 1 || Math.abs(a.y - b.y) > 1) {
            strokes.current.push(s);
            saveStrokes();
            snapshotHistory();
            emitAddedStroke(s);
          }
        }
      }
      currentStroke.current = null;
      drawing.current = false;
      markDirty();
    }

    // erase strokes under the pointer — prioritize non-image strokes so
    // drawings on top of photos can be erased cleanly without deleting the photo
    function eraseAt(w) {
      const threshold = (14 + linewidthRef.current) / view.current.scale;
      const before = strokes.current.length;
      
      const hasNonImageHit = strokes.current.some(
        (s) => s.type !== "image" && hitTestStroke(w, s, threshold, true)
      );

      if (hasNonImageHit) {
        strokes.current = strokes.current.filter(
          (s) => s.type === "image" || !hitTestStroke(w, s, threshold, true)
        );
      } else {
        strokes.current = strokes.current.filter(
          (s) => !hitTestStroke(w, s, threshold, true)
        );
      }

      if (strokes.current.length !== before) markDirty();
    }

    // ---- text tool ----
    function openTextEditor(screenX, screenY, worldX, worldY) {
      pendingTextRef.current = { worldX, worldY };
      setTextEditor({ left: screenX, top: screenY });
    }

    function commitTextEditor() {
      const pending = pendingTextRef.current;
      pendingTextRef.current = null;
      setTextEditor(null);
      if (!pending) return;

      const value = textAreaRef.current ? textAreaRef.current.value : "";
      if (!value || !value.trim()) return; // nothing typed, don't leave a stray box behind

      ctx.font = TEXT_FONT_SIZE + "px sans-serif";
      const lines = value.split("\n");
      const widths = lines.map((l) => ctx.measureText(l).width);
      const boxW = Math.max(40, ...widths);
      const lineHeight = TEXT_FONT_SIZE * 1.15;
      const boxH = lineHeight * lines.length;

      strokes.current.push({
        type: "text",
        color: lineColorRef.current,
        width: linewidthRef.current,
        text: value,
        points: [
          { x: pending.worldX, y: pending.worldY },
          { x: pending.worldX + boxW, y: pending.worldY + boxH },
        ],
      });
      selectedIndex.current = strokes.current.length - 1;
      saveStrokes();
      snapshotHistory();
      markDirty();
      emitAddedStroke(strokes.current[strokes.current.length - 1]);
      toolRef.current = "cursor";
      setTool("cursor"); // hop to select so the resize handles are right there
    }

    function cancelTextEditor() {
      pendingTextRef.current = null;
      setTextEditor(null);
    }

    commitTextEditorRef.current = commitTextEditor;
    cancelTextEditorRef.current = cancelTextEditor;

    // ---- double tap = text tool, triple tap = select tool ----
    function registerTap(screenX, screenY) {
      const t = tapRef.current;
      const now = Date.now();
      const withinTime = now - t.lastTime < TAP_WINDOW_MS;
      const withinDist =
        dist({ x: screenX, y: screenY }, { x: t.lastX, y: t.lastY }) < TAP_MOVE_THRESHOLD;

      t.count = withinTime && withinDist ? t.count + 1 : 1;
      t.lastTime = now;
      t.lastX = screenX;
      t.lastY = screenY;

      if (t.timer) clearTimeout(t.timer);
      t.timer = setTimeout(finalizeTapGesture, TAP_WINDOW_MS);
    }

    function finalizeTapGesture() {
      const t = tapRef.current;
      const count = t.count;
      t.count = 0;
      t.timer = null;

      if (count === 2) {
        const worldPos = toWorld(t.lastX, t.lastY);
        toolRef.current = "text";
        setTool("text");
        openTextEditor(
          rectRef.current.left + t.lastX,
          rectRef.current.top + t.lastY,
          worldPos.x,
          worldPos.y,
        );
      } else if (count >= 3) {
        toolRef.current = "cursor";
        setTool("cursor");
      }
    }

    function pointerDown(e) {
      // clicking anywhere on the canvas while a text box is open commits it first
      if (pendingTextRef.current) {
        commitTextEditor();
      }

      canvas.setPointerCapture(e.pointerId);
      const pos = getScreenPos(e);
      activePointers.current.set(e.pointerId, pos);

      if (activePointers.current.size === 2) {
        e.preventDefault();
        endCurrentStroke();
        startPinch();
        // a pinch starting mid-tap-sequence shouldn't count as a tap
        pointerDownTimes.current.clear();
        tapRef.current.count = 0;
        if (tapRef.current.timer) {
          clearTimeout(tapRef.current.timer);
          tapRef.current.timer = null;
        }
        return;
      }

      if (activePointers.current.size !== 1) return;
      e.preventDefault();

      pointerDownTimes.current.set(e.pointerId, { x: pos.x, y: pos.y, time: Date.now() });

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
        // if something's already selected, its resize handles sit on top
        // of the shape, so they get first crack at the click
        if (selectedIndex.current >= 0 && strokes.current[selectedIndex.current]) {
          const s = strokes.current[selectedIndex.current];
          const handleThreshold = 10 / view.current.scale;
          const hit = getHandles(s).find((h) => dist(w, h) <= handleThreshold);
          if (hit) {
            resizing.current = {
              index: selectedIndex.current,
              role: hit.role,
              originalPoints: s.points.map((p) => ({ ...p })),
            };
            return;
          }
        }

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
        openTextEditor(e.clientX, e.clientY, w.x, w.y);
        return;
      }

      if (currentTool === "image") {
        // placement happens through the file-picker effect, not a canvas click
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

      if (currentTool === "cursor" && resizing.current) {
        const s = strokes.current[resizing.current.index];
        if (s) {
          const type = s.type || "pencil";
          if (type === "pencil") {
            const origBounds = boundsOf({ points: resizing.current.originalPoints });
            const anchor = cornerPoint(origBounds, OPPOSITE_CORNER[resizing.current.role]);
            const draggedOrig = cornerPoint(origBounds, resizing.current.role);
            const spanX = draggedOrig.x - anchor.x;
            const spanY = draggedOrig.y - anchor.y;
            const scaleX = spanX !== 0 ? (w.x - anchor.x) / spanX : 1;
            const scaleY = spanY !== 0 ? (w.y - anchor.y) / spanY : 1;
            s.points = resizing.current.originalPoints.map((p) => ({
              ...p,
              x: anchor.x + (p.x - anchor.x) * scaleX,
              y: anchor.y + (p.y - anchor.y) * scaleY,
            }));
          } else if (resizing.current.role === "a") {
            s.points[0] = w;
          } else {
            s.points[1] = w;
          }
          markDirty();
        }
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

      emitCursorMove(w);

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
        emitLiveStroke(currentStroke.current);
        markDirty();
      }
    }

    function pointerUp(e) {
      const pos = getScreenPos(e);
      const downInfo = pointerDownTimes.current.get(e.pointerId);
      pointerDownTimes.current.delete(e.pointerId);
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
          snapshotHistory();
          syncStrokesToSocket();
        }
        if (dragging.current) {
          dragging.current = false;
          saveStrokes();
          snapshotHistory();
          syncStrokesToSocket();
        }
        if (resizing.current) {
          resizing.current = null;
          saveStrokes();
          snapshotHistory();
          syncStrokesToSocket();
        }

        // quick release with barely any movement = a tap, feeds the
        // double/triple tap detector regardless of which tool is active
        if (downInfo) {
          const moved = dist(pos, downInfo);
          const duration = Date.now() - downInfo.time;
          if (moved < 8 && duration < 300) {
            registerTap(pos.x, pos.y);
          }
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
      if (pendingTextRef.current) return; // typing in the text box, don't nuke anything

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }

      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        toolRef.current === "cursor" &&
        selectedIndex.current >= 0
      ) {
        strokes.current.splice(selectedIndex.current, 1);
        selectedIndex.current = -1;
        saveStrokes();
        snapshotHistory();
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
      if (tapRef.current.timer) clearTimeout(tapRef.current.timer);
    };
  }, []);

  const sentValu = (value) => {
    setBgcolor(value.backgroundColor);
    setLinecolor(value.fillColor);
    setLinewidth(value.stockWidth);
    setTool(value.selectedTool);
    setFile(value.file);
  };

  return (
    <>
      <RoomBar
        roomId={roomId}
        setRoomId={setRoomId}
        onJoinRoom={handleJoinRoom}
        isConnected={isConnected}
        userCount={userCount}
        onGenerateRoom={handleGenerateRoom}
      />
      <Header sentValu={sentValu} onUndo={undo} onRedo={redo} />
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
      {textEditor && (
        <textarea
          ref={textAreaRef}
          autoFocus
          onBlur={() => commitTextEditorRef.current && commitTextEditorRef.current()}
          onKeyDown={(e) => {
            e.stopPropagation(); // don't let Backspace/Delete/Ctrl+Z bubble up to the canvas
            if (e.key === "Escape") {
              e.preventDefault();
              cancelTextEditorRef.current && cancelTextEditorRef.current();
            }
          }}
          style={{
            position: "fixed",
            left: textEditor.left,
            top: textEditor.top,
            minWidth: "160px",
            minHeight: "32px",
            padding: "2px 4px",
            background: "rgba(0,0,0,0.55)",
            color: linecolor,
            fontSize: TEXT_FONT_SIZE + "px",
            fontFamily: "sans-serif",
            border: "1px dashed #3b82f6",
            borderRadius: "4px",
            outline: "none",
            resize: "none",
            zIndex: 60,
          }}
        />
      )}
    </>
  );
}