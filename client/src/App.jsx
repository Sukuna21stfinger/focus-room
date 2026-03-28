import { useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import Home from "./Home";
import Room from "./Room";

export default function App() {
  const [soundOn, setSoundOn] = useState(true);

  return (
    <BrowserRouter>
      <button className="sound-toggle" onClick={() => setSoundOn((s) => !s)} title="Toggle sound">
        {soundOn ? "Sound ON" : "Sound OFF"}
      </button>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/room/:roomId" element={<Room soundOn={soundOn} />} />
      </Routes>
    </BrowserRouter>
  );
}
