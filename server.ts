import express from "express";
import path from "path";
import https from "node:https";
import http from "node:http";
import { URL } from "node:url";
import { createServer as createViteServer } from "vite";

function streamAudio(targetUrl: string, req: express.Request, res: express.Response, redirectsLeft = 5) {
  if (redirectsLeft <= 0) {
    if (!res.headersSent) res.status(502).send("Too many redirects");
    return;
  }

  try {
    const parsed = new URL(targetUrl);
    const protocol = parsed.protocol === "http:" ? http : https;

    const headers: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "*/*"
    };

    if (req.headers.range) {
      headers["Range"] = req.headers.range;
    }

    const proxyReq = protocol.get(targetUrl, { headers }, (upstreamRes) => {
      // Follow HTTP redirects (301, 302, 303, 307, 308)
      if (upstreamRes.statusCode && upstreamRes.statusCode >= 300 && upstreamRes.statusCode < 400 && upstreamRes.headers.location) {
        let location = upstreamRes.headers.location;
        if (location.startsWith("/")) {
          location = `${parsed.protocol}//${parsed.host}${location}`;
        }
        upstreamRes.resume();
        return streamAudio(location, req, res, redirectsLeft - 1);
      }

      // Check if Google Drive returned virus scan warning HTML page
      const contentType = upstreamRes.headers["content-type"] || "";
      if (contentType.includes("text/html") && targetUrl.includes("drive.google.com") && !targetUrl.includes("confirm=")) {
        let htmlBody = "";
        upstreamRes.on("data", (chunk) => {
          if (htmlBody.length < 25000) htmlBody += chunk.toString();
        });
        upstreamRes.on("end", () => {
          const matchConfirm = htmlBody.match(/confirm=([a-zA-Z0-9_-]+)/) || htmlBody.match(/download_warning_[^=]+=([a-zA-Z0-9_-]+)/);
          const confirmToken = matchConfirm ? matchConfirm[1] : "t";
          const confirmUrl = `${targetUrl}&confirm=${confirmToken}`;
          return streamAudio(confirmUrl, req, res, redirectsLeft - 1);
        });
        return;
      }

      const statusCode = upstreamRes.statusCode || 200;
      res.status(statusCode);

      let outContentType = contentType;
      if (!outContentType || outContentType.includes("octet-stream") || outContentType.includes("text/plain") || outContentType.includes("binary")) {
        outContentType = "audio/mpeg";
      }

      res.setHeader("Content-Type", outContentType);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type, Accept");
      // Edge Caching ensures CDN caching for lightning fast repeated playbacks
      res.setHeader("Cache-Control", "public, max-age=31536000, s-maxage=31536000, stale-while-revalidate=86400");

      if (upstreamRes.headers["content-length"]) {
        res.setHeader("Content-Length", upstreamRes.headers["content-length"]);
      }
      if (upstreamRes.headers["content-range"]) {
        res.setHeader("Content-Range", upstreamRes.headers["content-range"]);
      }

      upstreamRes.pipe(res);

      req.on("close", () => {
        upstreamRes.destroy();
      });
    });

    proxyReq.on("error", (err) => {
      console.error("Audio stream proxy error:", err);
      if (!res.headersSent) {
        res.status(502).send("Error streaming audio");
      }
    });

    req.on("close", () => {
      proxyReq.destroy();
    });

  } catch (err) {
    console.error("Invalid URL in audio proxy:", err);
    if (!res.headersSent) {
      res.status(400).send("Invalid audio URL");
    }
  }
}

function extractDriveId(inputUrl?: string): string | null {
  if (!inputUrl) return null;
  const matchFileD = inputUrl.match(/\/(?:file\/)?d\/([a-zA-Z0-9_-]+)/);
  if (matchFileD && matchFileD[1]) return matchFileD[1];
  const matchIdParam = inputUrl.match(/[?&](?:id|docid)=([a-zA-Z0-9_-]+)/);
  if (matchIdParam && matchIdParam[1]) return matchIdParam[1];
  const matchLh3 = inputUrl.match(/googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/);
  if (matchLh3 && matchLh3[1]) return matchLh3[1];
  return null;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Audio proxy endpoint with range and stream forwarding
  app.get("/api/audio-proxy", (req, res) => {
    const fileId = (req.query.id as string) || (req.query.url ? extractDriveId(req.query.url as string) : null);
    let targetUrl = "";

    if (fileId) {
      targetUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
    } else if (req.query.url) {
      targetUrl = req.query.url as string;
    } else {
      return res.status(400).send("Missing id or url parameter");
    }

    streamAudio(targetUrl, req, res);
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
