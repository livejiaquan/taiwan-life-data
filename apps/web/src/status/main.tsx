import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { StatusApp } from "./StatusApp";
import "../styles.css";

hydrateRoot(
  document.getElementById("root")!,
  <StrictMode>
    <StatusApp />
  </StrictMode>,
);
