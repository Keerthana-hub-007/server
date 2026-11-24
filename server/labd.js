// Calls labd's chat endpoint. Server-side only: the API key must never reach a browser.
import { ApiError } from './errors.js';

// LABD_API_URL lets the tests point this at a fake labd. Normal use leaves it unset.
const API_URL = process.env.LABD_API_URL ?? 'https://agent.thedevlabs.io/v1/api/chat';

// labd sends nothing until the answer is finished, and a long answer can take over 4 minutes.
const TIMEOUT_MS = 300_000;

const MISSING_KEY =
  'LABD_API_KEY is not set. Make a key at https://learn.thedevlabs.io/settings/developers, then set it and restart the server.';

// labd's guidance: these failures are worth one retry. Everything else goes straight back to the learner.
const RETRY_ONCE = new Set(['upstream', 'stalled']);

async function callOnce(messages, effort) {
  const key = process.env.LABD_API_KEY ?? process.env['LABD-API-KEY'];
  if (!key) throw new ApiError(500, 'missing_key', MISSING_KEY);

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messages, effort }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();

  if (!res.ok) {
    let error;
    try {
      error = JSON.parse(text);
    } catch {
      error = { code: 'http_error', message: text.slice(0, 200) };
    }
    const retryAfter = Number(res.headers.get('retry-after')) || undefined;
    throw new ApiError(
      res.status,
      error.code ?? 'http_error',
      error.message ?? `labd returned ${res.status}.`,
      { retryAfter }
    );
  }

  const body = JSON.parse(text);
  return { content: body.message.content, credits: body.credits };
}

// Sends the conversation so far and returns labd's answer as Markdown.
// `messages` is [{ role, content }, ...]; the last one must be the user's.
export async function askLabd(messages, { effort = 'medium' } = {}) {
  try {
    return await callOnce(messages, effort);
  } catch (error) {
    if (!(error instanceof ApiError) || !RETRY_ONCE.has(error.code)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 3000));
    return callOnce(messages, effort);
  }
}
