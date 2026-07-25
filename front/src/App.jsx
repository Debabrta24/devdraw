
import React, { useState } from "react";
import Header from "./Component/Header";
import Canvas from "./Component/Canvas"
const App = () => {
  const [data, setData] = useState({});

  const sentValu = (value) => {
    console.log(value);
    setData(value);
  };
  return (
    <>
      {/* <Header sentValu={sentValu} /> */}
      <Canvas/>
    </>
  );
};

export default App;
