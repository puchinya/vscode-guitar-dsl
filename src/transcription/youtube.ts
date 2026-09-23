// YouTube URL validation and normalization helpers.
// Pure module independent of VS Code APIs and network.

const ALLOWED_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'youtu.be']);
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * Extracts the 11-character YouTube video ID from an HTTPS URL.
 * Returns null if the URL is invalid, non-HTTPS, not from an allowed YouTube host,
 * or does not contain a valid video ID.
 */
export function extractYouTubeVideoId(inputUrl: string): string | null {
  if (!inputUrl || typeof inputUrl !== 'string') {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(inputUrl.trim());
  } catch {
    return null;
  }

  // Must be HTTPS
  if (parsed.protocol !== 'https:') {
    return null;
  }

  // Must be from allowed YouTube host
  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) {
    return null;
  }

  if (host === 'youtu.be') {
    // Pathname is /<videoId>
    const id = parsed.pathname.slice(1);
    return VIDEO_ID_RE.test(id) ? id : null;
  }

  // youtube.com or www.youtube.com
  const path = parsed.pathname;

  if (path === '/watch') {
    const id = parsed.searchParams.get('v');
    return id && VIDEO_ID_RE.test(id) ? id : null;
  }

  const pathPrefixes = ['/embed/', '/v/', '/shorts/'];
  for (const prefix of pathPrefixes) {
    if (path.startsWith(prefix)) {
      const id = path.slice(prefix.length).split('/')[0];
      return VIDEO_ID_RE.test(id) ? id : null;
    }
  }

  return null;
}

/**
 * Validates whether the given URL string is an HTTPS URL pointing to a valid YouTube video.
 */
export function isValidYouTubeUrl(inputUrl: string): boolean {
  return extractYouTubeVideoId(inputUrl) !== null;
}

/**
 * Normalizes any valid YouTube video URL to the canonical watch URL:
 * https://www.youtube.com/watch?v=<videoId>
 * Throws an error if the URL is invalid.
 */
export function normalizeYouTubeUrl(inputUrl: string): string {
  const videoId = extractYouTubeVideoId(inputUrl);
  if (!videoId) {
    throw new Error(`Invalid YouTube video URL: '${inputUrl}'`);
  }
  return `https://www.youtube.com/watch?v=${videoId}`;
}
