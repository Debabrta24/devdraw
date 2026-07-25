import React, { useEffect } from "react";

const Footer = ({ sendX }) => {
  const x = 2;

  useEffect(() => {
    sendX(x);
  }, []);

  return <div>Footer</div>;
};

export default Footer;