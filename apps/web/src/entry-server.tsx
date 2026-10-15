import { renderToString } from "react-dom/server";
import { App } from "./App";
import { StatusApp } from "./status/StatusApp";

/** First-render markup per page; the client hydrates it (main.tsx, status/main.tsx). */
export const render = (page: "home" | "status"): string => renderToString(page === "home" ? <App /> : <StatusApp />);
