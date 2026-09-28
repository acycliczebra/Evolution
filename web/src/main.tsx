import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { loadMeta, loadTime } from "./data";
import { I18nProvider } from "./i18n";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);

Promise.all([loadMeta(), loadTime()])
  .then(([meta, time]) =>
    root.render(
      <StrictMode>
        <I18nProvider>
          <App meta={meta} time={time} />
        </I18nProvider>
      </StrictMode>,
    ),
  )
  .catch(err => root.render(<p style={{ padding: 24 }}>Failed to load data: {String(err)}</p>));
