/**
 * Vercel Serverless Function: Audio Proxy Fallback
 * 
 * Lightweight HTTP 302 redirect to direct Google Drive/external media URL.
 * NEVER streams or buffers binary media through Vercel compute to keep
 * Fast Origin Transfer (FOT) at virtually 0 bytes.
 */

export default async function handler(req, res) {
  try {
    const fileId = req.query.id || (req.query.url ? extractDriveId(req.query.url) : null);
    const rawUrl = req.query.url;

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
  } catch (err) {
    console.error("Audio redirect error:", err);
    return res.status(500).send("Error processing audio redirect");
  }
}

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
