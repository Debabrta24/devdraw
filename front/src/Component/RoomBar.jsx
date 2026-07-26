import React, { useState } from "react";
import {
  FiUsers,
  FiCopy,
  FiCheck,
  FiChevronUp,
  FiChevronDown,
  FiPlus,
  FiZap,
  FiWifi,
  FiWifiOff,
} from "react-icons/fi";

const RoomBar = ({
  roomId,
  setRoomId,
  onJoinRoom,
  isConnected,
  userCount,
  onGenerateRoom,
}) => {
  const [inputRoom, setInputRoom] = useState(roomId || "");
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleJoin = (e) => {
    e.preventDefault();
    if (inputRoom.trim()) {
      onJoinRoom(inputRoom.trim());
    }
  };

  const handleCopy = () => {
    if (roomId) {
      navigator.clipboard.writeText(roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCreateNew = () => {
    const newRoom = onGenerateRoom();
    setInputRoom(newRoom);
    onJoinRoom(newRoom);
  };

  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 ease-in-out">
      {isCollapsed ? (
        /* Collapsed minimal badge */
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/80 px-3 py-1.5 shadow-2xl backdrop-blur-md ring-1 ring-white/10 text-xs text-gray-200">
          <span
            className={`h-2 w-2 rounded-full ${
              isConnected ? "bg-emerald-500 animate-pulse" : "bg-rose-500"
            }`}
          />
          <span className="font-mono font-medium text-gray-300">
            {roomId ? `Room: ${roomId}` : "Offline"}
          </span>
          {isConnected && (
            <span className="flex items-center gap-1 text-[11px] text-gray-400">
              <FiUsers size={12} />
              {userCount}
            </span>
          )}
          <button
            onClick={() => setIsCollapsed(false)}
            className="ml-1 rounded-full p-1 text-gray-400 hover:bg-white/10 hover:text-white transition"
            title="Expand Room Toolbar"
          >
            <FiChevronDown size={14} />
          </button>
        </div>
      ) : (
        /* Full expanded Room Bar */
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-neutral-950/90 p-2 shadow-[0_10px_30px_rgba(0,0,0,0.8)] backdrop-blur-xl ring-1 ring-white/10 text-xs">
          {/* Connection Status Indicator */}
          <div className="flex items-center gap-1.5 rounded-xl bg-white/5 px-2.5 py-1.5 text-gray-300">
            {isConnected ? (
              <span className="flex items-center gap-1 text-emerald-400 font-medium">
                <FiWifi size={14} />
                Live
              </span>
            ) : (
              <span className="flex items-center gap-1 text-rose-400 font-medium">
                <FiWifiOff size={14} />
                Offline
              </span>
            )}
          </div>

          {/* Join / Create Form */}
          <form onSubmit={handleJoin} className="flex items-center gap-1.5">
            <div className="relative">
              <input
                type="text"
                placeholder="Enter Room ID..."
                value={inputRoom}
                onChange={(e) => setInputRoom(e.target.value)}
                className="w-36 sm:w-48 rounded-xl border border-white/10 bg-neutral-900/90 px-3 py-1.5 text-xs text-white placeholder-gray-500 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
              />
            </div>

            <button
              type="submit"
              className="flex items-center gap-1 rounded-xl bg-blue-600 px-3 py-1.5 font-medium text-white transition hover:bg-blue-500 active:scale-95 shadow-md shadow-blue-600/20"
            >
              <FiZap size={13} />
              Join
            </button>

            <button
              type="button"
              onClick={handleCreateNew}
              className="flex items-center gap-1 rounded-xl border border-white/10 bg-neutral-800 px-2.5 py-1.5 font-medium text-gray-200 transition hover:bg-neutral-700 hover:text-white active:scale-95"
              title="Generate New Room ID"
            >
              <FiPlus size={13} />
              New
            </button>
          </form>

          {/* Room Metadata & Actions */}
          {roomId && (
            <div className="flex items-center gap-1.5 border-l border-white/10 pl-2">
              {/* Copy Room ID Button */}
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1 rounded-xl border border-white/10 bg-neutral-800/80 px-2.5 py-1.5 text-gray-300 transition hover:bg-neutral-700 hover:text-white"
                title="Copy Room ID"
              >
                {copied ? (
                  <>
                    <FiCheck size={13} className="text-emerald-400" />
                    <span className="text-emerald-400 font-medium">Copied!</span>
                  </>
                ) : (
                  <>
                    <FiCopy size={13} />
                    <span className="font-mono text-[11px]">{roomId}</span>
                  </>
                )}
              </button>

              {/* Active Users Badge */}
              <div
                className="flex items-center gap-1 rounded-xl bg-blue-500/10 border border-blue-500/20 px-2.5 py-1.5 text-blue-400 font-medium"
                title={`${userCount} active user(s) in this room`}
              >
                <FiUsers size={13} />
                <span>{userCount}</span>
              </div>
            </div>
          )}

          {/* Hide / Collapse Bar Button */}
          <button
            onClick={() => setIsCollapsed(true)}
            className="ml-1 rounded-xl p-1.5 text-gray-400 hover:bg-white/10 hover:text-white transition"
            title="Hide Room Bar"
          >
            <FiChevronUp size={16} />
          </button>
        </div>
      )}
    </div>
  );
};

export default RoomBar;
