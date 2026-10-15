import { renderToString } from "react-dom/server";
import { App } from "./App";
import { StatusApp } from "./status/StatusApp";
import { TodayApp } from "./today/TodayApp";

const PAGES = { home: App, status: StatusApp, today: TodayApp };

/** First-render markup per page; the client hydrates it (main.tsx, status/main.tsx, today/main.tsx). */
export const render = (page: keyof typeof PAGES): string => {
  const Page = PAGES[page];
  return renderToString(<Page />);
};
