import React, { useState, useRef, useEffect } from "react";

import { CiUnlock, CiLock, CiText, CiEraser } from "react-icons/ci";
import { HiOutlineCursorArrowRays } from "react-icons/hi2";
import { FaRegCircle, FaRegHandPaper } from "react-icons/fa";
import { FaPencil } from "react-icons/fa6";
import {
  MdOutlinePhoto,
  MdOutlineWaterDrop,
  MdCheckBoxOutlineBlank,
} from "react-icons/md";
import { IoArrowForwardOutline, IoChevronForward } from "react-icons/io5";
import { TbStrokeStraight } from "react-icons/tb";

const Header = ({ sentValu }) => {
  const [lock, setLock] = useState(false);
  const [selectedTool, setSelectedTool] = useState("pencil");
  const [fillColor, setFillColor] = useState("#ff0000");
  const [backgroundColor, setBackgroundColor] = useState("#ffffff");
  const [file, setFile] = useState(null);
  const [opacity, setOpacity] = useState(100);
  const [stockWidth, setStockWidth] = useState(2);

  // which flyout / popover is currently open ("view" | "shapes" | "draw" | "colors" | null)
  const [openPanel, setOpenPanel] = useState(null);

  // true while a native color input is focused/active — while true we ignore
  // the outside-click handler so picking a color never gets cut off/closed early
  const [colorPickerActive, setColorPickerActive] = useState(false);

  const photoref = useRef(null);
  const wrapperRef = useRef(null);

  useEffect(() => {
    sentValu({
      selectedTool,
      fillColor,
      backgroundColor,
      file,
      opacity,
      stockWidth,
    });
  }, [selectedTool, fillColor, backgroundColor, file, opacity, stockWidth]);

  // close any open flyout / popover when clicking outside the toolbar.
  // uses the "click" event (not "mousedown") on purpose: a click always fires
  // AFTER any blur caused by the focus shift, so colorPickerActive has already
  // settled to false by the time we check it here — letting the user swipe
  // freely through the native color picker without the panel closing mid-drag,
  // while a click on the canvas right after still closes it reliably.
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (colorPickerActive) return;
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpenPanel(null);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [colorPickerActive]);

  // ---- standalone tools (not grouped) ----
  const standalone = {
    eraser: { id: "eraser", icon: <CiEraser size={20} /> },
    image: { id: "image", icon: <MdOutlinePhoto size={20} /> },
  };

  // preset swatches for the color popover — kept vivid & varied on purpose
  const presetColors = [
    "#ff3b30", "#ff9500", "#ffcc00", "#34c759",
    "#00c7be", "#30b0c7", "#007aff", "#5856d6",
    "#af52de", "#ff2d55", "#000000", "#ffffff",
  ];

  // ---- grouped tools: each group renders ONE button, which expands ----
  // ---- into a flyout of its own sub-options when clicked ----
  const groups = {
    view: {
      id: "view",
      options: [
        { id: "cursor", icon: <HiOutlineCursorArrowRays size={20} />, label: "Cursor" },
        { id: "hand", icon: <FaRegHandPaper size={20} />, label: "Hand" },
      ],
    },
    shapes: {
      id: "shapes",
      options: [
        { id: "rectangle", icon: <MdCheckBoxOutlineBlank size={20} />, label: "Rectangle" },
        { id: "circle", icon: <FaRegCircle size={20} />, label: "Circle" },
        { id: "line", icon: <TbStrokeStraight size={20} />, label: "Line" },
        { id: "arrow", icon: <IoArrowForwardOutline size={20} />, label: "Arrow" },
      ],
    },
    draw: {
      id: "draw",
      options: [
        { id: "text", icon: <CiText size={20} />, label: "Text" },
        { id: "pencil", icon: <FaPencil size={18} />, label: "Pencil" },
      ],
    },
  };

  const togglePanel = (id) => setOpenPanel((prev) => (prev === id ? null : id));

  const selectFromGroup = (toolId) => {
    setSelectedTool(toolId);
    setOpenPanel(null);
  };
  const groupMainIcon = (group) => {
    const active = group.options.find((o) => o.id === selectedTool);
    return active ? active.icon : group.options[0].icon;
  };

  const isGroupActive = (group) => group.options.some((o) => o.id === selectedTool);

  const buttonBaseClass = (active) => `
    relative
    flex
    h-10
    w-10
    items-center
    justify-center
    rounded-xl
    text-gray-300
    transition-all
    duration-200
    ease-out
    border
    border-black
    hover:bg-blue-600
    hover:text-white
    hover:scale-110
    active:scale-95
    active:bg-blue-700
    touch-manipulation
    ${active ? "bg-blue-600 text-white shadow-lg" : "bg-transparent"}
  `;

  return (
    <>
      <input
        ref={photoref}
        type="file"
        accept="image/*,.pdf"
        onChange={(e) => setFile(e.target.files[0])}
        className="hidden"
      />

      <div ref={wrapperRef} className="fixed left-4 top-1/2 z-50 -translate-y-1/2">
        <div className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-black p-1 shadow-[0_8px_30px_rgba(0,0,0,0.6)] backdrop-blur-md ring-1 ring-white/5">
          {/* lock */}
          <button
            onClick={() => setLock(!lock)}
            className={buttonBaseClass(false)}
            title={lock ? "Unlock" : "Lock"}
          >
            {lock ? <CiLock size={20} /> : <CiUnlock size={20} />}
          </button>

          {/* view group: cursor / hand */}
          <div className="relative">
            <button
              onClick={() => togglePanel("view")}
              className={buttonBaseClass(isGroupActive(groups.view) || openPanel === "view")}
              title="Cursor / Hand"
            >
              {groupMainIcon(groups.view)}
              <IoChevronForward
                size={9}
                className="absolute bottom-0.5 right-0.5 opacity-70"
              />
            </button>

            {openPanel === "view" && (
              <div className="absolute left-12 top-0 flex gap-1 rounded-xl border border-black bg-black p-1 shadow-2xl">
                {groups.view.options.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => selectFromGroup(opt.id)}
                    title={opt.label}
                    className={buttonBaseClass(selectedTool === opt.id)}
                  >
                    {opt.icon}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* shapes group: rectangle / circle / line */}
          <div className="relative">
            <button
              onClick={() => togglePanel("shapes")}
              className={buttonBaseClass(isGroupActive(groups.shapes) || openPanel === "shapes")}
              title="Rectangle / Circle / Line"
            >
              {groupMainIcon(groups.shapes)}
              <IoChevronForward
                size={9}
                className="absolute bottom-0.5 right-0.5 opacity-70"
              />
            </button>

            {openPanel === "shapes" && (
              <div className="absolute left-12 top-0 flex gap-1 rounded-xl border border-black bg-black p-1 shadow-2xl">
                {groups.shapes.options.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => selectFromGroup(opt.id)}
                    title={opt.label}
                    className={buttonBaseClass(selectedTool === opt.id)}
                  >
                    {opt.icon}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* draw group: text / pencil */}
          <div className="relative">
            <button
              onClick={() => togglePanel("draw")}
              className={buttonBaseClass(isGroupActive(groups.draw) || openPanel === "draw")}
              title="Text / Pencil"
            >
              {groupMainIcon(groups.draw)}
              <IoChevronForward
                size={9}
                className="absolute bottom-0.5 right-0.5 opacity-70"
              />
            </button>

            {openPanel === "draw" && (
              <div className="absolute left-12 top-0 flex gap-1 rounded-xl border border-black bg-black p-1 shadow-2xl">
                {groups.draw.options.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => selectFromGroup(opt.id)}
                    title={opt.label}
                    className={buttonBaseClass(selectedTool === opt.id)}
                  >
                    {opt.icon}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* eraser (standalone) */}
          <button
            onClick={() => setSelectedTool(standalone.eraser.id)}
            className={buttonBaseClass(selectedTool === standalone.eraser.id)}
            title="Eraser"
          >
            {standalone.eraser.icon}
          </button>

          {/* image (standalone) */}
          <button
            onClick={() => photoref.current.click()}
            className={buttonBaseClass(false)}
            title="Insert Image"
          >
            {standalone.image.icon}
          </button>

          {/* colors group: fill + background merged into one button */}
          <div className="relative">
            <button
              onClick={() => togglePanel("colors")}
              className={buttonBaseClass(openPanel === "colors")}
              title="Fill / Background color"
              style={
                openPanel !== "colors"
                  ? { background: `linear-gradient(135deg, ${fillColor}, ${backgroundColor})` }
                  : undefined
              }
            >
              <MdOutlineWaterDrop size={20} className="drop-shadow" />
              <IoChevronForward
                size={9}
                className="absolute bottom-0.5 right-0.5 opacity-80 drop-shadow"
              />
            </button>

            {openPanel === "colors" && (
              <div className="absolute bottom-0 left-12 w-56 overflow-hidden rounded-2xl border border-white/10 bg-neutral-900 shadow-2xl">
                {/* gradient header strip */}
                <div
                  className="h-2 w-full"
                  style={{
                    background:
                      "linear-gradient(90deg, #ff3b30, #ff9500, #ffcc00, #34c759, #00c7be, #007aff, #5856d6, #af52de, #ff2d55)",
                  }}
                />

                <div className="p-3">
                  {/* Fill color */}
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                    Fill
                  </p>
                  <label className="relative mb-2 flex w-full cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-neutral-800 px-2 py-1.5 transition hover:border-blue-400 hover:bg-neutral-700">
                    <span
                      className="h-7 w-7 shrink-0 rounded-lg border-2 border-white/20 shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
                      style={{ backgroundColor: fillColor }}
                    />
                    <span className="text-xs font-medium uppercase tracking-wide text-gray-200">
                      {fillColor}
                    </span>
                    <span className="ml-auto rounded-md bg-neutral-900 px-1.5 py-0.5 text-[10px] text-gray-400">
                      custom
                    </span>
                    <input
                      type="color"
                      value={fillColor}
                      onChange={(e) => setFillColor(e.target.value)}
                      onFocus={() => setColorPickerActive(true)}
                      onBlur={() => setColorPickerActive(false)}
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    />
                  </label>
                  <div className="mb-3 grid grid-cols-6 gap-1.5">
                    {presetColors.map((c) => (
                      <button
                        key={`fill-${c}`}
                        onClick={() => setFillColor(c)}
                        title={c}
                        className={`h-6 w-6 rounded-full border-2 transition hover:scale-110 ${
                          fillColor.toLowerCase() === c
                            ? "border-blue-400 shadow-[0_0_0_2px_rgba(59,130,246,0.5)]"
                            : "border-white/20"
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>

                  {/* Opacity */}
                  <div className="mb-3">
                    <div className="mb-1 flex items-center justify-between">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                        Opacity
                      </p>
                      <span className="rounded-md bg-neutral-800 px-1.5 py-0.5 text-[10px] font-medium text-gray-300">
                        {opacity}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={opacity}
                      onChange={(e) => setOpacity(Number(e.target.value))}
                      className="h-1.5 w-full cursor-pointer appearance-none rounded-full accent-blue-500"
                      style={{
                        background: `linear-gradient(90deg, ${fillColor} 0%, ${fillColor} ${opacity}%, #3f3f46 ${opacity}%, #3f3f46 100%)`,
                      }}
                    />
                  </div>

                  {/* Background color */}
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                    Background
                  </p>
                  <label className="relative mb-2 flex w-full cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-neutral-800 px-2 py-1.5 transition hover:border-blue-400 hover:bg-neutral-700">
                    <span
                      className="h-7 w-7 shrink-0 rounded-lg border-2 border-white/20 shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
                      style={{ backgroundColor: backgroundColor }}
                    />
                    <span className="text-xs font-medium uppercase tracking-wide text-gray-200">
                      {backgroundColor}
                    </span>
                    <span className="ml-auto rounded-md bg-neutral-900 px-1.5 py-0.5 text-[10px] text-gray-400">
                      custom
                    </span>
                    <input
                      type="color"
                      value={backgroundColor}
                      onChange={(e) => setBackgroundColor(e.target.value)}
                      onFocus={() => setColorPickerActive(true)}
                      onBlur={() => setColorPickerActive(false)}
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    />
                  </label>
                  <div className="grid grid-cols-6 gap-1.5">
                    {presetColors.map((c) => (
                      <button
                        key={`bg-${c}`}
                        onClick={() => setBackgroundColor(c)}
                        title={c}
                        className={`h-6 w-6 rounded-full border-2 transition hover:scale-110 ${
                          backgroundColor.toLowerCase() === c
                            ? "border-blue-400 shadow-[0_0_0_2px_rgba(59,130,246,0.5)]"
                            : "border-white/20"
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>

                  {/* Stroke / Stock width */}
                  <div className="mt-3">
                    <div className="mb-1 flex items-center justify-between">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                        Stroke Width
                      </p>
                      <span className="rounded-md bg-neutral-800 px-1.5 py-0.5 text-[10px] font-medium text-gray-300">
                        {stockWidth}px
                      </span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={20}
                      step={1}
                      value={stockWidth}
                      onChange={(e) => setStockWidth(Number(e.target.value))}
                      className="h-1.5 w-full cursor-pointer appearance-none rounded-full accent-blue-500"
                      style={{
                        background: `linear-gradient(90deg, #3b82f6 0%, #3b82f6 ${
                          (stockWidth / 20) * 100
                        }%, #3f3f46 ${(stockWidth / 20) * 100}%, #3f3f46 100%)`,
                      }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default Header;