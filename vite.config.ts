import { defineConfig, loadEnv, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { handleBoardPhoto } from "./api/board-photo.ts";
import { handleArasaacImage, handleArasaacSearch } from "./src/lib/arasaacProxy.ts";

function localBoardApi(mode: string): Plugin {
  function configure(server: { middlewares: Connect.Server }) {
    const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
    server.middlewares.use((request, response, next) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname === "/api/board-photo") {
        void handleBoardPhoto(request, response, env).catch(() => {
          if (response.headersSent) return response.end();
          response.writeHead(502, { "Cache-Control": "private, no-store" });
          return response.end();
        });
        return;
      }

      const handler = url.pathname === "/api/arasaac-search" ? handleArasaacSearch
        : url.pathname === "/api/arasaac-image" ? handleArasaacImage : null;
      if (!handler) return next();

      void (async () => {
        try {
          const result = await handler(new Request(url, { method: request.method }));
          const body = Buffer.from(await result.arrayBuffer());
          response.writeHead(result.status, Object.fromEntries(result.headers));
          response.end(body);
        } catch {
          response.writeHead(502, { "Cache-Control": "no-store" });
          response.end();
        }
      })();
    });
  }

  return {
    name: "comunica-local-board-api",
    configureServer: configure,
    configurePreviewServer: configure,
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), localBoardApi(mode)],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api/tts": { target: "http://127.0.0.1:8000", changeOrigin: true },
    },
  },
  preview: { port: 4173, strictPort: true },
}));
