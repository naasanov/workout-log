// Pure logic for redacting embedded base64 images out of stored chat
// transcript `parts` arrays. Split out from redactOldChatImages.js so it can
// be unit-tested (node:test) without a DB connection.
//
// Root cause / context: chat_messages.parts stores AI SDK UIMessage parts as
// JSON, and food photos get embedded as full base64 data URIs directly in
// that JSON. With no retention policy this filled the production JawsDB
// free-tier 5MB quota and took the whole DB read-only. This module implements
// the redaction step of the fix: strip embedded image bytes from old rows
// while leaving a visible marker behind so the UI can show "photo no longer
// available" instead of silently dropping the attachment.
'use strict';

/** True if a value looks like a base64(ish) data: URI. */
function isDataUri(value) {
  return typeof value === 'string' && value.startsWith('data:');
}

/**
 * Redact embedded image data out of a single UIMessage `parts` array.
 *
 * - `{ type: 'file', mediaType: 'image/...', url: 'data:...' }` parts are
 *   replaced with `{ type: 'data-imageRedacted', data: { mediaType } }`.
 * - `{ type: 'data-barcodeAttachment', data: { imageDataUrl: 'data:...' } }`
 *   parts have `imageDataUrl` nulled out and `imageRedacted: true` set on
 *   `data`, keeping `code`/`product` intact.
 * - All other part types are left untouched (including already-redacted
 *   parts, which makes this idempotent).
 *
 * Returns `{ parts, changed }` — `changed` is false when nothing needed
 * redaction, letting the caller skip the UPDATE entirely.
 */
function redactParts(parts) {
  if (!Array.isArray(parts)) return { parts, changed: false };

  let changed = false;

  const next = parts.map((part) => {
    if (!part || typeof part !== 'object') return part;

    if (
      part.type === 'file' &&
      typeof part.mediaType === 'string' &&
      part.mediaType.startsWith('image/') &&
      isDataUri(part.url)
    ) {
      changed = true;
      return { type: 'data-imageRedacted', data: { mediaType: part.mediaType } };
    }

    if (
      part.type === 'data-barcodeAttachment' &&
      part.data &&
      typeof part.data === 'object' &&
      isDataUri(part.data.imageDataUrl)
    ) {
      changed = true;
      return {
        ...part,
        data: {
          ...part.data,
          imageDataUrl: null,
          imageRedacted: true,
        },
      };
    }

    return part;
  });

  return { parts: next, changed };
}

module.exports = { redactParts, isDataUri };
