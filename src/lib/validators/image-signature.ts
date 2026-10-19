/**
 * Pure server-side image signature inspection (magic bytes).
 * Ensures that files claimed to be images actually contain valid binary headers,
 * preventing MIME spoofing and rejecting disallowed payloads before storage upload.
 */

export interface ValidatedImage {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  extension: 'jpg' | 'png' | 'webp';
}

export function validateImageSignature(buffer: Buffer | Uint8Array): ValidatedImage | null {
  if (!buffer || buffer.length < 12) {
    return null;
  }

  // PNG Signature: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { mimeType: 'image/png', extension: 'png' };
  }

  // JPEG Signature: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  }

  // WebP Signature: RIFF .... WEBP
  const riff = String.fromCharCode(buffer[0], buffer[1], buffer[2], buffer[3]);
  const webp = String.fromCharCode(buffer[8], buffer[9], buffer[10], buffer[11]);
  if (riff === 'RIFF' && webp === 'WEBP') {
    return { mimeType: 'image/webp', extension: 'webp' };
  }

  return null;
}
