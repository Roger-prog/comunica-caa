import { StrictMode, lazy } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider } from "./auth/AuthProvider";
import { Application } from "./Application";
import { BrowserRouter } from "react-router-dom";
import "./styles.css";

const Workspace = lazy(() => import("./Workspace"));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Application workspace={Workspace} />
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
);
