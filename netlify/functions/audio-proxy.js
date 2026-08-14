export default async (req, context) => {
  try {
    const url = new URL(req.url);
    const fileId = url.searchParams.get("id") || (url.searchParams.get("url") ? extractDriveId(url.searchParams.get("url")) : null);
    const rawUrl = url.searchParams.get("url");

    if (!fileId && !rawUrl) {
      return new Response("Missing id or url parameter", { status: 400 });
    }

    const audioResult = fileId
      ? await fetchGoogleDriveFile(fileId)
      : await fetchExternalAudioUrl(rawUrl);

    if (!audioResult) {
      return new Response("Gagal memuat file audio dari Google Drive. Pastikan file dibagikan publik.", { status: 404 });
    }

    const { buffer, contentType } = audioResult;

    let mimeType = contentType;
    if (!mimeType || mimeType.includes("text/html") || mimeType.includes("application/octet-stream") || mimeType.includes("text/plain")) {
      mimeType = "audio/mpeg";
    }

    const totalSize = buffer.length;
    const rangeHeader = req.headers.get("range");

    const headers = {
      "Content-Type": mimeType,
      "Accept-Ranges": "bytes",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=86400",
    };

    if (rangeHeader) {
      const parts = rangeHeader.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10) || 0;
      const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
      const safeEnd = Math.min(end, totalSize - 1);
      const safeStart = Math.min(start, safeEnd);
      const chunkSize = safeEnd - safeStart + 1;

      headers["Content-Range"] = `bytes ${safeStart}-${safeEnd}/${totalSize}`;
      headers["Content-Length"] = String(chunkSize);

      return new Response(buffer.subarray(safeStart, safeEnd + 1), {
        status: 206,
        headers,
      });
    } else {
      headers["Content-Length"] = String(totalSize);
      return new Response(buffer, {
        status: 200,
        headers,
      });
    }
  } catch (err) {
    console.error("Netlify audio proxy error:", err);
    return new Response("Error fetching audio proxy", { status: 500 });
  }
};

function extractDriveId(inputUrl) {
  if (!inputUrl) return null;
  const matchFileD = inputUrl.match(/\/(?:file\/)?d\/([a-zA-Z0-9_-]+)/);
  if (matchFileD && matchFileD[1]) return matchFileD[1];
  const matchIdParam = inputUrl.match(/[?&](?:id|docid)=([a-zA-Z0-9_-]+)/);
  if (matchIdParam && matchIdParam[1]) return matchIdParam[1];
  const matchLh3 = inputUrl.match(/googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/);
  if (matchLh3 && matchLh3[1]) return matchLh3[1];
  return null;
}

async function fetchGoogleDriveFile(fileId) {
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

      if (res.ok && !contentType.includes("text/html")) {
        const arrayBuf = await res.arrayBuffer();
        if (arrayBuf.byteLength > 100) {
          return { buffer: Buffer.from(arrayBuf), contentType };
        }
      }

      if (res.ok && contentType.includes("text/html")) {
        const htmlText = await res.text();

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
      console.warn(`Netlify candidate ${url} failed for Drive ID ${fileId}:`, err);
    }
  }

  return null;
}

async function fetchExternalAudioUrl(rawUrl) {
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
