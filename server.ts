import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Audio redirect endpoint (lightweight 302 redirect, 0 buffer/bandwidth)
  app.get("/api/audio-proxy", (req, res) => {
    const fileId = req.query.id as string;
    const rawUrl = req.query.url as string;

    if (fileId) {
      const targetUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.redirect(302, targetUrl);
    }

    if (rawUrl) {
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.redirect(302, rawUrl);
    }

    return res.status(400).send("Missing id or url parameter");
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
