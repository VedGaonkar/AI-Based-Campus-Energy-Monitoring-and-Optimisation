// Shared text helpers: input hygiene, safe output, and the fence used around untrusted data.
import { randomBytes } from 'node:crypto';

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g;

export const clean = (value, max = 500) =>
  String(value ?? '')
    .replace(CONTROL, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

export const normalise = (text) =>
  clean(text, 600)
    .toLowerCase()
    .replace(/[?!.,;]+$/g, '')
    .trim();

// Website records can contain anything an administrator typed. Before they go anywhere near a
// model they are shortened, flattened to one line and stripped of anything that could close
// or imitate the data fence.
export const dataValue = (value, max = 120) =>
  clean(value, max)
    .replace(/[<>`]/g, '')
    .replace(/={3,}|-{3,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function newFence() {
  return `DATA-${randomBytes(6).toString('hex')}`;
}

// Model output is shown as plain text. Links the model invented are removed; only links the
// server builds from record IDs are ever rendered as links.
export function safeModelText(text, { max = 1200 } = {}) {
  return String(text ?? '')
    .replace(CONTROL, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, '[link removed]')
    .replace(/\bjavascript:/gi, '')
    .trim()
    .slice(0, max);
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
