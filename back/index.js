const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);




app.get("/", (req, res) => {
    res.send("server started")
})

// Enable Socket.io CORS for cross-origin requests from frontend (Vite default dev server ports)
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    },
    maxHttpBufferSize: 1e8, // 100 MB buffer for handling image uploads smoothly
});

// In-memory store for whiteboard room states
// roomId -> { strokes: Array, users: Map<socketId, { x, y, name, color }> }
const rooms = new Map();

function getRoomState(roomId) {
    if (!rooms.has(roomId)) {
        rooms.set(roomId, {
            strokes: [],
            users: new Map(),
        });
    }
    return rooms.get(roomId);
}

function getRoomUserCount(roomId) {
    const room = rooms.get(roomId);
    return room ? room.users.size : 0;
}

const PRESET_USER_COLORS = [
    "#ef4444", "#f97316", "#f59e0b", "#10b981",
    "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899"
];

io.on("connection", (socket) => {
    let currentRoomId = null;

    // Assign user random color and name tag
    const userColor = PRESET_USER_COLORS[Math.floor(Math.random() * PRESET_USER_COLORS.length)];
    const userName = `User-${socket.id.substring(0, 4)}`;

    // Join a collaboration room
    socket.on("join-room", (roomId) => {
        if (!roomId) return;

        // Leave previous room if any
        if (currentRoomId && currentRoomId !== roomId) {
            socket.leave(currentRoomId);
            const prevRoom = rooms.get(currentRoomId);
            if (prevRoom) {
                prevRoom.users.delete(socket.id);
                io.to(currentRoomId).emit("room-users-update", {
                    count: prevRoom.users.size,
                    users: Array.from(prevRoom.users.values()),
                });
            }
        }

        currentRoomId = roomId;
        socket.join(roomId);

        const room = getRoomState(roomId);
        room.users.set(socket.id, {
            id: socket.id,
            name: userName,
            color: userColor,
            x: 0,
            y: 0,
        });

        // Send initial canvas state & user list to the joining user
        socket.emit("init-room", {
            strokes: room.strokes,
            usersCount: room.users.size,
            userId: socket.id,
            userColor,
        });

        // Broadcast updated user count to room
        io.to(roomId).emit("room-users-update", {
            count: room.users.size,
            users: Array.from(room.users.values()),
        });
    });

    // Real-time live stroke preview (while user is drawing)
    socket.on("stroke:live", ({ roomId, stroke }) => {
        if (!roomId) return;
        socket.to(roomId).emit("stroke:live", {
            userId: socket.id,
            stroke,
        });
    });

    // Final stroke completed (user released pointer)
    socket.on("stroke:add", ({ roomId, stroke }) => {
        if (!roomId || !stroke) return;
        const room = getRoomState(roomId);
        room.strokes.push(stroke);
        socket.to(roomId).emit("stroke:add", stroke);
    });

    // Full strokes sync (after eraser, move, resize, undo, redo)
    socket.on("strokes:sync", ({ roomId, strokes }) => {
        if (!roomId || !Array.isArray(strokes)) return;
        const room = getRoomState(roomId);
        room.strokes = strokes;
        socket.to(roomId).emit("strokes:sync", strokes);
    });

    // Live remote cursor tracking
    socket.on("cursor:move", ({ roomId, cursor }) => {
        if (!roomId || !cursor) return;
        const room = rooms.get(roomId);
        if (room && room.users.has(socket.id)) {
            const u = room.users.get(socket.id);
            u.x = cursor.x;
            u.y = cursor.y;
        }
        socket.to(roomId).emit("cursor:move", {
            id: socket.id,
            color: userColor,
            name: userName,
            ...cursor,
        });
    });

    // Disconnect handling
    socket.on("disconnect", () => {
        if (currentRoomId) {
            const room = rooms.get(currentRoomId);
            if (room) {
                room.users.delete(socket.id);
                socket.to(currentRoomId).emit("user-left", socket.id);
                io.to(currentRoomId).emit("room-users-update", {
                    count: room.users.size,
                    users: Array.from(room.users.values()),
                });
                if (room.users.size === 0) {
                    // Keep empty rooms in memory briefly or retain strokes
                }
            }
        }
    });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
    console.log(`🚀 Socket.io Whiteboard backend running on port ${PORT}`);
});
