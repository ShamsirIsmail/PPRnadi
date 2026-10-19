/**
 * Validates audio container magic bytes to ensure uploaded audio files
 * are genuine audio streams, not spoofed or renamed binary payloads.
 */

export interface AudioSignatureValidationResult {
  valid: boolean;
  detectedFormat?: 'webm' | 'wav' | 'ogg' | 'mp4' | 'mp3';
  error?: string;
}

export function validateAudioSignature(buffer: Buffer): AudioSignatureValidationResult {
  if (!buffer || buffer.length < 12) {
    return {
      valid: false,
      error: 'Data audio terlalu kecil atau tidak lengkap untuk disahkan.',
    };
  }

  // 1. WebM / Matroska EBML: 0x1A 0x45 0xDF 0xA3
  if (
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    return { valid: true, detectedFormat: 'webm' };
  }

  // 2. RIFF / WAV: 'RIFF' at 0..3 and 'WAVE' at 8..11
  const riffHeader = buffer.subarray(0, 4).toString('ascii');
  const waveHeader = buffer.subarray(8, 12).toString('ascii');
  if (riffHeader === 'RIFF' && waveHeader === 'WAVE') {
    return { valid: true, detectedFormat: 'wav' };
  }

  // 3. OGG: 'OggS' at 0..3 (0x4F 0x67 0x67 0x53)
  const oggHeader = buffer.subarray(0, 4).toString('ascii');
  if (oggHeader === 'OggS') {
    return { valid: true, detectedFormat: 'ogg' };
  }

  // 4. ISO Base Media File Format (MP4 / M4A / AAC container): 'ftyp' at 4..7
  const ftypBox = buffer.subarray(4, 8).toString('ascii');
  if (ftypBox === 'ftyp') {
    return { valid: true, detectedFormat: 'mp4' };
  }

  // 5. MP3 with ID3v2 tag ('ID3' at 0..2) or MPEG frame sync (0xFF 0xFB / 0xFF 0xF3 / 0xFF 0xF2)
  const id3Header = buffer.subarray(0, 3).toString('ascii');
  if (id3Header === 'ID3') {
    return { valid: true, detectedFormat: 'mp3' };
  }
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) {
    return { valid: true, detectedFormat: 'mp3' };
  }

  return {
    valid: false,
    error: 'Format fail audio tidak sah atau tidak sepadan dengan tandatangan fail audio.',
  };
}
