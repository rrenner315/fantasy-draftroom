import React from "react";
import { createRoot } from "react-dom/client";
import Home from "../app/page";
import DraftCompanion from "../app/companion/page";
import "../app/globals.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {new URLSearchParams(window.location.search).has("companion") ? <DraftCompanion /> : <Home />}
  </React.StrictMode>,
);
