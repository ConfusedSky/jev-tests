import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Toasts } from "./components/Toast";

createRoot(document.getElementById("root")!).render(
  <Toasts>
    <App />
  </Toasts>,
);
