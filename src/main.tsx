import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app";
import "./styles/tokens.css";
import "./styles/app.css";

performance.mark("tabpad:main");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
