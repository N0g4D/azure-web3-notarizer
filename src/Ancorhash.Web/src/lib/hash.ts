/**
 * Client-side hashing with the native Web Crypto API (window.crypto.subtle).
 * Zero Data Leakage: the file is read into memory in the browser and is NEVER
 * sent to the backend — only its SHA-256 hash travels.
 */
export async function sha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
