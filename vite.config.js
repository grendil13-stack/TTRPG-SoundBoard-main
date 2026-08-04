import { defineConfig, loadEnv } from "vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function rootToLandingMiddleware(req, _res, next) {
  const raw = req.url || "/";
  const qIndex = raw.indexOf("?");
  const pathname = qIndex === -1 ? raw : raw.slice(0, qIndex);
  const search = qIndex === -1 ? "" : raw.slice(qIndex);
  if (pathname === "/" || pathname === "") {
    req.url = `/landing.html${search}`;
  }
  next();
}

function repoStaticAudioPlugin() {
  return {
    name: "repo-static-audio",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        rootToLandingMiddleware(req, res, () => {
          const url = (req.url || "").split("?")[0];
          if (url !== "/audio-manifest.json" && !url.startsWith("/Sounds/")) {
            next();
            return;
          }
          const rel = url.slice(1);
          const filePath = path.join(__dirname, rel);
          if (!filePath.startsWith(__dirname)) {
            next();
            return;
          }
          fs.stat(filePath, (err, st) => {
            if (err || !st.isFile()) {
              next();
              return;
            }
            if (url.endsWith(".json")) {
              res.setHeader("Content-Type", "application/json");
            } else if (url.endsWith(".ogg")) {
              res.setHeader("Content-Type", "audio/ogg");
            } else if (url.endsWith(".wav")) {
              res.setHeader("Content-Type", "audio/wav");
            } else if (url.endsWith(".mp3")) {
              res.setHeader("Content-Type", "audio/mpeg");
            }
            fs.createReadStream(filePath).pipe(res);
          });
        });
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use(rootToLandingMiddleware);
    },
    closeBundle() {
      const outDir = path.join(__dirname, "dist");
      const manifestSrc = path.join(__dirname, "audio-manifest.json");
      const manifestDest = path.join(outDir, "audio-manifest.json");
      const soundsSrc = path.join(__dirname, "Sounds");
      const soundsDest = path.join(outDir, "Sounds");
      if (fs.existsSync(manifestSrc)) {
        fs.copyFileSync(manifestSrc, manifestDest);
      }
      if (fs.existsSync(soundsSrc)) {
        fs.cpSync(soundsSrc, soundsDest, { recursive: true });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  loadEnv(mode, process.cwd(), "");

  return {
    plugins: [repoStaticAudioPlugin()],
    envDir: ".",
    envPrefix: "VITE_",
    build: {
      rollupOptions: {
        input: {
          main: path.join(__dirname, "landing.html"),
          legal: path.join(__dirname, "legal.html"),
          faq: path.join(__dirname, "faq.html"),
          app: path.join(__dirname, "app.html"),
          resetPassword: path.join(__dirname, "reset-password.html"),
        },
      },
    },
  };
});
