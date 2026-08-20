/**
 * Netlify Function: High-performance Google Drive Audio Streaming Proxy
 * 
 * Features:
 * - Direct stream piping via Web Streams API (0 RAM memory buffering)
 * - Full HTTP 206 Partial Content / Range header support (seeking & scrubbing)
 * - Automatic Google Drive ID extraction from various URL formats
 * - Google Drive large file virus-scan confirmation bypass
 * - Netlify Edge CDN caching (s-maxage=31536000) for instant repeated playback
 * - Full CORS support for HTML5 <audio> elements
 */

function extractDriveId(inputUrl) {
  if (!inputUrl) return null;
  const trimmed = inputUrl.trim();

  // 1. Standard file path format: /file/d/FILE_ID or /d/FILE_ID
  const matchFileD = trimmed.match(/\/(?:file\/)?d\/([a-zA-Z0-9_-]+)/);
  if (matchFileD && matchFileD[1]) return matchFileD[1];

  // 2. Query param format: id=FILE_ID or docid=FILE_ID
  const matchIdParam = trimmed.match(/[?&](?:id|docid)=([a-zA-Z0-9_-]+)/);
  if (matchIdParam && matchIdParam[1]) return matchIdParam[1];

  // 3. googleusercontent format: googleusercontent.com/d/FILE_ID
  const matchLh3 = trimmed.match(/googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/);
  if (matchLh3 && matchLh3[1]) return matchLh3[1];

  // 4. Standalone file ID (at least 20 alphanumeric/hyphen/underscore characters)
  if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed) && !trimmed.startsWith('http') && !trimmed.startsWith('data:')) {
    return trimmed;
  }

  return null;
}

export default async (req, context) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Content-Type, Accept',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  try {
    const urlObj = new URL(req.url);
    const idParam = urlObj.searchParams.get('id');
    const urlParam = urlObj.searchParams.get('url');

    const fileId = idParam || (urlParam ? extractDriveId(urlParam) : null);
    let targetUrl = '';

    if (fileId) {
      targetUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
    } else if (urlParam) {
      targetUrl = urlParam;
    } else {
      return new Response('Missing id or url parameter', {
        status: 400,
        headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Forward client headers
    const requestHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
    };

    const clientRange = req.headers.get('range');
    if (clientRange) {
      requestHeaders['Range'] = clientRange;
    }

    let upstreamRes = await fetch(targetUrl, {
      headers: requestHeaders,
      redirect: 'follow',
    });

    // Check if Google Drive returned a virus scan confirmation HTML page
    const contentType = upstreamRes.headers.get('content-type') || '';
    if (contentType.includes('text/html') && targetUrl.includes('drive.google.com') && !targetUrl.includes('confirm=')) {
      const htmlText = await upstreamRes.text();
      const matchConfirm = htmlText.match(/confirm=([a-zA-Z0-9_-]+)/) || htmlText.match(/download_warning_[^=]+=([a-zA-Z0-9_-]+)/);
      const confirmToken = matchConfirm ? matchConfirm[1] : 't';
      const confirmUrl = `${targetUrl}&confirm=${confirmToken}`;

      upstreamRes = await fetch(confirmUrl, {
        headers: requestHeaders,
        redirect: 'follow',
      });
    }

    let outContentType = upstreamRes.headers.get('content-type') || 'audio/mpeg';
    if (
      outContentType.includes('text/plain') ||
      outContentType.includes('octet-stream') ||
      outContentType.includes('binary') ||
      outContentType.includes('html')
    ) {
      outContentType = 'audio/mpeg';
    }

    const responseHeaders = new Headers();
    responseHeaders.set('Content-Type', outContentType);
    responseHeaders.set('Accept-Ranges', 'bytes');
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', 'Range, Content-Type, Accept');
    responseHeaders.set('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, stale-while-revalidate=86400');

    const contentLength = upstreamRes.headers.get('content-length');
    if (contentLength) responseHeaders.set('Content-Length', contentLength);

    const contentRange = upstreamRes.headers.get('content-range');
    if (contentRange) responseHeaders.set('Content-Range', contentRange);

    return new Response(upstreamRes.body, {
      status: upstreamRes.status || 200,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('Netlify audio-proxy error:', error);
    return new Response('Error streaming audio from source', {
      status: 502,
      headers: {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
};
