// Pure logic for shrinking stored chat transcript `parts` arrays. Split out
// from redactOldChatImages.js so it can be unit-tested (node:test) without a
// DB connection.
//
// Root cause / context: chat_messages.parts stores AI SDK UIMessage parts as
// JSON. This module implements the two retention passes that keep that table
// bounded (see scripts/redactOldChatImages.js's header for the full incident
// history, which happened TWICE):
//
//   1. redactParts    — strips embedded base64 image bytes (food photos,
//                        barcode scans) from old rows.
//   2. trimToolPayloads — strips the bulky `input`/`output`/`result` fields
//                        off old `tool-*` parts (calculator calls, food
//                        search results, web search results, etc). This is
//                        the one that actually matters at scale: in the
//                        second occurrence of the incident, image bytes were
//                        already being redacted correctly and the table was
//                        STILL 3+ MB over 42 days, almost entirely from
//                        thousands of tool-call transcripts (2114
//                        tool-calculator parts alone, individual assistant
//                        rows up to 96KB) that nothing was ever trimming.
//
// Both functions leave a visible marker behind (`imageRedacted` /
// `payloadTrimmed`) rather than silently dropping data, so the client can
// render an explicit "no longer available" state instead of a broken card.
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

/**
 * Strip the bulky payload out of old `tool-*` parts, keeping just enough for
 * the UI to still render *something* (`type`, `toolCallId`, `state`) plus a
 * `payloadTrimmed: true` marker.
 *
 * Why this is needed and why it's separate from `redactParts`: the AI SDK
 * stores the FULL tool call input and output inline on each part —
 * `{ type: 'tool-calculator', toolCallId, state, input: {...}, output: {...} }`.
 * For tools like search_foods/search_foods_batch/web_search that's easily
 * multiple KB per call, and a single food-logging conversation can rack up
 * dozens of calls. Unlike images, this data has no natural "expiry" story in
 * the UI (there's no thumbnail to show "unavailable" for) — it's just
 * historical debugging/context weight that the model no longer needs once
 * the conversation it belonged to isn't going to be resumed. So instead of
 * an age-based image cutoff (hours, chosen to survive a same-session
 * refresh), this uses a longer cutoff (days, default 7 — see
 * CHAT_TOOLPAYLOAD_RETENTION_DAYS in redactOldChatImages.js) chosen to
 * comfortably outlive any realistic multi-day return-to-this-conversation
 * window while still bounding growth.
 *
 * `text` and `reasoning` parts are deliberately never touched here — only
 * `type`s starting with the `tool-` prefix that the AI SDK uses for
 * tool-call parts.
 *
 * Idempotent: a part that already has `payloadTrimmed: true` is left alone
 * (and does not count as a change), same pattern as `redactParts` skipping
 * already-redacted image parts — this is what lets repeated runs over the
 * same aging rows stay cheap.
 *
 * Returns `{ parts, changed }`, mirroring `redactParts`.
 */
function trimToolPayloads(parts) {
  if (!Array.isArray(parts)) return { parts, changed: false };

  let changed = false;

  const next = parts.map((part) => {
    if (!part || typeof part !== 'object') return part;
    if (typeof part.type !== 'string' || !part.type.startsWith('tool-')) return part;
    if (part.payloadTrimmed === true) return part; // already trimmed — idempotent

    changed = true;
    const trimmed = { type: part.type, payloadTrimmed: true };
    if (Object.prototype.hasOwnProperty.call(part, 'toolCallId')) {
      trimmed.toolCallId = part.toolCallId;
    }
    if (Object.prototype.hasOwnProperty.call(part, 'state')) {
      trimmed.state = part.state;
    }
    return trimmed;
  });

  return { parts: next, changed };
}

/**
 * True if a mysql2 error is JawsDB revoking INSERT for exceeding the storage
 * quota (error 1142, ER_TABLEACCESS_DENIED_ERROR). Pulled out as its own
 * predicate so the OPTIMIZE-TABLE catch-and-log path in
 * redactOldChatImages.js can be unit tested with a fake error object, and so
 * we only swallow THIS specific failure mode rather than masking real bugs.
 */
function isInsertPrivilegeError(err) {
  return Boolean(err) && err.code === 'ER_TABLEACCESS_DENIED_ERROR';
}

module.exports = { redactParts, isDataUri, trimToolPayloads, isInsertPrivilegeError };
