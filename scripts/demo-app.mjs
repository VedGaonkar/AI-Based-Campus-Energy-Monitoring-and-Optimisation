import { createServer } from "vite";
import { fileURLToPath } from "node:url";
const role = process.argv[2];
if (!["camera", "classroom"].includes(role)) throw new Error("Use camera or classroom");
const path = role === "camera" ? "cctv-camera" : "circuit-board", port = role === "camera" ? 5174 : 5175;
const server = await createServer({ configFile: false, root: fileURLToPath(new URL("../demo/", import.meta.url)),
  server: { host: "localhost", port, strictPort: true, proxy: { "/api": { target: "http://127.0.0.1:5000" }, "/socket.io": { target: "http://127.0.0.1:5000", ws: true } } },
});
await server.listen();
console.log(`Demo ${role}: http://localhost:${port}/${path}/ — uses the existing backend on port 5000. Phones require the documented trusted HTTPS origin.`);
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => { await server.close(); process.exit(0); });
