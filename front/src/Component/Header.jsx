import React, { useState, useRef } from "react";
import { CiUnlock, CiLock, CiText, CiEraser } from "react-icons/ci";
import { HiOutlineCursorArrowRays } from "react-icons/hi2";
import { FaRegCircle, FaRegHandPaper } from "react-icons/fa";
import { FaPencil } from "react-icons/fa6";
import {
  MdOutlinePhoto,
  MdOutlineWaterDrop,
  MdCheckBoxOutlineBlank,
} from "react-icons/md";
import { IoArrowForwardOutline } from "react-icons/io5";
import { TbStrokeStraight, TbBackground } from "react-icons/tb";

const Header = () => {
  const [lock, setLock] = useState(false);
  const [selectedTool, setSelectedTool] = useState("pencil");
  const [fillColor, setFillColor] = useState("#ff0000");
  const [backgroundColor, setBackgroundColor] = useState("#ffffff");

  const fillRef = useRef(null);
  const backgroundRef = useRef(null);
  console.log(selectedTool);

  const drawcolor = ({}) => {
    return (
      <>
        <p>jhug</p>
      </>
    );
  };
  const backGroundColor = () => {};
  const tools = [
    {
      id: "lock",
      icon: lock ? <CiLock size={20} /> : <CiUnlock size={20} />,
      action: () => setLock(!lock),
    },
    {
      id: "cursor",
      icon: <HiOutlineCursorArrowRays size={20} />,
    },
    {
      id: "hand",
      icon: <FaRegHandPaper size={22} />,
    },
    {
      id: "rectangle",
      icon: <MdCheckBoxOutlineBlank size={20} />,
    },
    {
      id: "circle",
      icon: <FaRegCircle size={22} />,
    },
    {
      id: "line",
      icon: <TbStrokeStraight size={20} />,
    },
    {
      id: "arrow",
      icon: <IoArrowForwardOutline size={22} />,
    },
    {
      id: "text",
      icon: <CiText size={20} />,
    },
    {
      id: "pencil",
      icon: <FaPencil size={20} />,
    },
    {
      id: "eraser",
      icon: <CiEraser size={20} />,
    },
    {
      id: "image",
      icon: <MdOutlinePhoto size={20} />,
    },
    {
      id: "fill",
      icon: <MdOutlineWaterDrop size={20} />,
    },
    {
      id: "background",
      icon: <TbBackground size={20} />,
    },
  ];

  return (
    <>
      <div className="fixed ">
        <div className="flex flex-col gap-2 rounded-2xl border  bg-black p-0.5 shadow-2xl backdrop-blur-md">
          {tools.map((tool) => (
            <button
              key={tool.id}
              onClick={() => {
                if (tool.id === "fill") {
                  fillRef.current.click();
                  return;
                }

                if (tool.id === "background") {
                  backgroundRef.current.click();
                  return;
                }

                if (tool.action) {
                  tool.action();
                } else {
                  setSelectedTool(tool.id);
                }
              }}
              className={`
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

                ${
                  selectedTool === tool.id
                    ? "bg-blue-600 text-white shadow-lg"
                    : "bg-transparent"
                }
            `}
            >
              {tool.icon}
            </button>
          ))}
        </div>
      </div>
    </>
  );
};

export default Header;
