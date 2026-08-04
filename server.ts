import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Audio Proxy endpoint to bypass Google Drive CORS & direct download restrictions
  app.get("/api/audio-proxy", async (req, res) => {
    try {
      const fileId = req.query.id as string;
      const rawUrl = req.query.url as string;

      let targetUrl = "";
      if (fileId) {
        targetUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;
      } else if (rawUrl) {
        targetUrl = rawUrl;
      } else {
        return res.status(400).send("Missing id or url parameter");
      }

      // Fetch audio from Google Drive or external URL server-side
      let response = await fetch(targetUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });

      // If redirect or warning page returned HTML, try fallback googleusercontent download links
      let contentType = response.headers.get("content-type") || "";
      if (fileId && (!response.ok || contentType.includes("text/html"))) {
        const fallbackUrls = [
          `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`,
          `https://lh3.googleusercontent.com/d/${fileId}`,
          `https://docs.google.com/uc?export=download&id=${fileId}`,
          `https://drive.google.com/uc?id=${fileId}`
        ];

        for (const altUrl of fallbackUrls) {
          try {
            const altResp = await fetch(altUrl, {
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              },
            });
            const altContentType = altResp.headers.get("content-type") || "";
            if (altResp.ok && !altContentType.includes("text/html")) {
              response = altResp;
              contentType = altContentType;
              break;
            }
          } catch (e) {
            // continue next fallback
          }
        }
      }

      if (!response.ok) {
        return res.status(response.status).send("Gagal mengambil audio dari Google Drive.");
      }

      // Determine proper audio content type if header is generic octet-stream
      let mimeType = contentType;
      if (!mimeType || mimeType.includes("application/octet-stream") || mimeType.includes("text/plain")) {
        mimeType = "audio/mpeg";
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      res.setHeader("Content-Type", mimeType);
      res.setHeader("Content-Length", buffer.length);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "public, max-age=86400");

      return res.send(buffer);
    } catch (err: any) {
      console.error("Audio proxy error:", err);
      return res.status(500).send("Error fetching audio proxy");
    }
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
