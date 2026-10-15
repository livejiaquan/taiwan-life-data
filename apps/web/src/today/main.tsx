import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { TodayApp } from "./TodayApp";
import "../styles.css";

hydrateRoot(
  document.getElementById("root")!,
  <StrictMode>
    <TodayApp />
  </StrictMode>,
);
