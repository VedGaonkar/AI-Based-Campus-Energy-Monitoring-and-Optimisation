import { defineConfig, loadEnv } from "vite";
import { deploymentOrigin } from "../shared/deployment-origins.js";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  for (const name of ["VITE_API_ORIGIN", "VITE_REALTIME_ORIGIN"]) deploymentOrigin(env[name], { production: mode === "production", optional: true, label: name });
  return {
  plugins: [react(), tailwindcss()],
  server: {
    host: "localhost",
    port: 5173,
    strictPort: true,
    proxy: {
      "/assistant": { target: "http://127.0.0.1:5000" },
      "/demo/": { target: "http://127.0.0.1:5000" },
      "/api": { target: "http://127.0.0.1:5000" },
      "/socket.io": { target: "http://127.0.0.1:5000", ws: true },
    },
  },
  };
});
