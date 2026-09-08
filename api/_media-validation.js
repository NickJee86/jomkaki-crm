const clean = value => String(value ?? '').trim();

export const WHATSAPP_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
// WebP is a sticker format in the Cloud API, not an image-message format.
export const WHATSAPP_IMAGE_TYPES = new Set(['image/jpeg', 'image/png']);

export async function validatePublicImageLink(imageUrl, { fetchImpl = fetch, timeoutMs = 3500 } = {}) {
  const url = clean(imageUrl);
  if (!/^https:\/\//i.test(url)) return { ok: false, reason: 'INVALID_IMAGE_URL' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { Range: 'bytes=0-1023', 'User-Agent': 'JomKaki-WhatsApp-Media-Check/1.0' },
      signal: controller.signal
    });
    const contentType = clean(response.headers?.get?.('content-type')).toLowerCase().split(';')[0].trim();
    const rangeTotal = clean(response.headers?.get?.('content-range')).match(/^bytes\s+\d+-\d+\/(\d+)$/i)?.[1];
    // A range response's Content-Length describes only the preview bytes.
    const contentLength = Number(rangeTotal || response.headers?.get?.('content-length') || 0);
    const supportedType = WHATSAPP_IMAGE_TYPES.has(contentType);
    const supportedSize = !contentLength || contentLength <= WHATSAPP_IMAGE_MAX_BYTES;
    try { await response.body?.cancel?.(); } catch {}
    return {
      ok: response.ok && supportedType && supportedSize,
      reason: !response.ok ? `IMAGE_HTTP_${response.status}` : !supportedType ? 'UNSUPPORTED_IMAGE_TYPE' : !supportedSize ? 'IMAGE_TOO_LARGE' : '',
      contentType,
      contentLength
    };
  } catch (error) {
    return { ok: false, reason: error?.name === 'AbortError' ? 'IMAGE_CHECK_TIMEOUT' : 'IMAGE_CHECK_FAILED' };
  } finally {
    clearTimeout(timeout);
  }
}
