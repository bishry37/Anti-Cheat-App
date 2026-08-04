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

      if (!fileId && !rawUrl) {
        return res.status(400).send("Missing id or url parameter");
      }

      const audioResult = fileId
        ? await fetchGoogleDriveFile(fileId)
        : await fetchExternalAudioUrl(rawUrl);

      if (!audioResult) {
        return res.status(404).send("Gagal memuat file audio dari Google Drive. Pastikan file dibagikan publik.");
      }

      const { buffer, contentType } = audioResult;

      // Clean & set proper audio MIME type
      let mimeType = contentType;
      if (!mimeType || mimeType.includes("text/html") || mimeType.includes("application/octet-stream") || mimeType.includes("text/plain")) {
        mimeType = "audio/mpeg";
      }

      const totalSize = buffer.length;
      const rangeHeader = req.headers.range;

      res.setHeader("Content-Type", mimeType);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "public, max-age=86400");

      if (rangeHeader) {
        const parts = rangeHeader.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10) || 0;
        const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
        const safeEnd = Math.min(end, totalSize - 1);
        const safeStart = Math.min(start, safeEnd);
        const chunkSize = safeEnd - safeStart + 1;

        res.status(206);
        res.setHeader("Content-Range", `bytes ${safeStart}-${safeEnd}/${totalSize}`);
        res.setHeader("Content-Length", chunkSize);
        return res.send(buffer.subarray(safeStart, safeEnd + 1));
      } else {
        res.status(200);
        res.setHeader("Content-Length", totalSize);
        return res.send(buffer);
      }
    } catch (err: any) {
      console.error("Audio proxy error:", err);
      return res.status(500).send("Error fetching audio proxy");
    }
  });

async function fetchGoogleDriveFile(fileId: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

  const candidateUrls = [
    `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`,
    `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`,
    `https://lh3.googleusercontent.com/d/${fileId}`,
    `https://docs.google.com/uc?export=download&id=${fileId}`
  ];

  for (const url of candidateUrls) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": userAgent },
        redirect: "follow",
      });

      const contentType = res.headers.get("content-type") || "";
      const setCookie = res.headers.get("set-cookie") || "";

      // If valid binary stream (not HTML)
      if (res.ok && !contentType.includes("text/html")) {
        const arrayBuf = await res.arrayBuffer();
        if (arrayBuf.byteLength > 100) {
          return { buffer: Buffer.from(arrayBuf), contentType };
        }
      }

      // If Google returned HTML (e.g. virus scan / download confirmation page)
      if (res.ok && contentType.includes("text/html")) {
        const htmlText = await res.text();

        // Try extracting direct download link or confirm token from HTML
        const linkMatch =
          htmlText.match(/href="([^"]*export=download[^"]*)"/i) ||
          htmlText.match(/href="(https:\/\/drive\.usercontent\.google\.com\/download[^"]*)"/i) ||
          htmlText.match(/action="(https:\/\/drive\.usercontent\.google\.com\/download[^"]*)"/i);

        const confirmMatch =
          htmlText.match(/confirm=([a-zA-Z0-9_-]+)/i) ||
          htmlText.match(/name="confirm"\s+value="([^"]+)"/i);

        let downloadUrl = "";
        if (linkMatch && linkMatch[1]) {
          downloadUrl = linkMatch[1].replace(/&amp;/g, "&");
          if (downloadUrl.startsWith("/")) {
            downloadUrl = `https://drive.google.com${downloadUrl}`;
          }
        } else {
          const confirmCode = confirmMatch ? confirmMatch[1] : "t";
          downloadUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=${confirmCode}`;
        }

        const cookieHeader = setCookie ? setCookie.split(";")[0] : "";
        const res2 = await fetch(downloadUrl, {
          headers: {
            "User-Agent": userAgent,
            ...(cookieHeader ? { Cookie: cookieHeader } : {})
          },
          redirect: "follow",
        });

        const contentType2 = res2.headers.get("content-type") || "";
        if (res2.ok && !contentType2.includes("text/html")) {
          const arrayBuf2 = await res2.arrayBuffer();
          if (arrayBuf2.byteLength > 100) {
            return { buffer: Buffer.from(arrayBuf2), contentType: contentType2 };
          }
        }
      }
    } catch (err) {
      console.warn(`Candidate ${url} failed for Google Drive ${fileId}:`, err);
    }
  }

  return null;
}

async function fetchExternalAudioUrl(rawUrl: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
  try {
    const res = await fetch(rawUrl, {
      headers: { "User-Agent": userAgent },
      redirect: "follow",
    });

    if (res.ok) {
      const contentType = res.headers.get("content-type") || "audio/mpeg";
      const arrayBuf = await res.arrayBuffer();
      return { buffer: Buffer.from(arrayBuf), contentType };
    }
  } catch (err) {
    console.warn(`Failed fetching external URL ${rawUrl}:`, err);
  }
  return null;
}

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
