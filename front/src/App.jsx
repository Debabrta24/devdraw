// import React, { useState } from "react";
// import Footer from "./Component/Footer";

// function App() {
//   const [x, setX] = useState(0);

//   return (
//     <>
//       <h1>{x}</h1>

//       <Footer sendX={setX} />
//     </>
//   );
// }

// export default App;

import React, { useState } from "react";
import Header from "./Component/Header";

const App = () => {
  const [data, setData] = useState({});

  const sentValu = (value) => {
    console.log(value);
    setData(value);
  };
  return (
    <>
      <Header sentValu={sentValu} />
    </>
  );
};

export default App;
