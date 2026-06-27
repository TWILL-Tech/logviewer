import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

// NOTE: StrictMode is intentionally omitted. It double-invokes effects in dev,
// which conflicts with the imperative uPlot create/destroy lifecycle and makes
// behavior diverge from production.
createRoot(document.getElementById("root")!).render(<App />);
