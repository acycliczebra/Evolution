import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { loadMeta, loadTime } from "./data";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);

Promise.all([loadMeta(), loadTime()])
  .then(([meta, time]) =>
    root.render(
      <StrictMode>
        <App meta={meta} time={time} />
      </StrictMode>,
    ),
  )
  .catch(err => root.render(<p style={{ padding: 24 }}>Failed to load data: {String(err)}</p>));
