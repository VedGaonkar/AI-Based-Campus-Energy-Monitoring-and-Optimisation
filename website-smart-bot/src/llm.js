import { FunctionCallingConfigMode, GoogleGenAI } from '@google/genai';
import { REASON_TEXT } from './quota.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Pulls Gemini's own "retry in N seconds" hint out of an error, whatever shape it arrives in.
export function retryAfterSeconds(err, fallback = 30) {
  const text = `${err?.message ?? ''} ${JSON.stringify(err?.details ?? '')}`;
  const a = text.match(/retry in ([\d.]+)\s*s/i) ?? text.match(/"retryDelay"\s*:\s*"([\d.]+)s"/i) ?? text.match(/retryDelay\W+([\d.]+)s/i);
  return a ? Math.max(1, Math.ceil(Number(a[1]))) : fallback;
}

export function classifyError(err) {
  const status = Number(err?.status ?? err?.code);
  if (status === 429) return { reason: 'remote_rate_limit', retryAfterSec: retryAfterSeconds(err) };
  if (status === 401 || status === 403) return { reason: 'auth_error', message: 'The Gemini API key was rejected.' };
  if (status === 404) return { reason: 'model_error', message: 'The configured Gemini model was not found for this API key.' };
  if (status === 400) return { reason: 'model_error', message: 'Gemini rejected the request.' };
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return { reason: 'timeout', message: 'Gemini did not answer in time.' };
  return { reason: 'unavailable', message: 'Gemini is temporarily unavailable.' };
}

// Real SDK call. Only this function knows the SDK's request shape.
function sdkGenerate({ config }) {
  const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  return async ({ system, contents, tools }) => {
    const response = await ai.models.generateContent({
      model: config.gemini.model,
      contents,
      config: {
        systemInstruction: system,
        temperature: 0,
        maxOutputTokens: config.gemini.maxOutputTokens,
        abortSignal: AbortSignal.timeout(config.gemini.timeoutMs),
        ...(config.gemini.thinkingLevel !== 'DEFAULT' ? { thinkingConfig: { thinkingLevel: config.gemini.thinkingLevel } } : {}),
        ...(tools?.length
          ? { tools: [{ functionDeclarations: tools }], toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } } }
          : {}),
      },
    });
    // Reading .text on a function-call response makes the SDK log a warning, so only read it when there is none.
    const calls = response.functionCalls ?? [];
    return {
      text: calls.length ? '' : (response.text ?? ''),
      functionCalls: calls.map((c) => ({ name: c.name, args: c.args ?? {} })),
      usage: response.usageMetadata ? { input: response.usageMetadata.promptTokenCount, output: response.usageMetadata.candidatesTokenCount } : null,
    };
  };
}

export function createLlm({ config, budget, generate, wait = sleep, log = () => {} }) {
  const impl = generate ?? (config.gemini.apiKey ? sdkGenerate({ config }) : null);

  return {
    model: config.gemini.model,
    available: Boolean(impl),

    // One logical question. At most two requests ever leave: the first, and a single retry after
    // a short 429, and only if the budget still has room. Everything else fails fast.
    async ask({ userId, priority, system, contents, tools }) {
      if (!impl) return { ok: false, reason: 'not_configured', message: 'No Gemini API key is configured.' };

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const reservation = budget.reserve({ userId, priority });
        if (!reservation.ok) {
          return { ok: false, reason: reservation.reason, retryAfterSec: reservation.retryAfterSec, message: REASON_TEXT[reservation.reason] };
        }
        try {
          const out = await impl({ system, contents, tools });
          budget.settle(reservation, 'ok');
          return { ok: true, ...out, remainingToday: reservation.remainingAfter };
        } catch (err) {
          const failure = classifyError(err);
          budget.settle(reservation, failure.reason === 'remote_rate_limit' ? '429' : failure.reason);
          log(`gemini ${failure.reason} status=${err?.status ?? 'n/a'}`);
          if (failure.reason !== 'remote_rate_limit') return { ok: false, ...failure };
          budget.pauseFor(failure.retryAfterSec);
          // Retry only a short wait, once. A long wait is reported instead of blocking the user.
          if (attempt === 0 && failure.retryAfterSec * 1000 <= config.gemini.maxRetryWaitMs) {
            // A small margin so the retry never lands inside the pause it just set.
            await wait(failure.retryAfterSec * 1000 + 250);
            continue;
          }
          return { ok: false, ...failure };
        }
      }
      return { ok: false, reason: 'remote_rate_limit', retryAfterSec: 30 };
    },
  };
}

// Used by `npm run check:model`; metadata lookups, not a generateContent request.
export async function verifyModel(config) {
  const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  try {
    const model = await ai.models.get({ model: config.gemini.model });
    return { ok: true, name: model.name, displayName: model.displayName };
  } catch (err) {
    const names = [];
    try {
      const pager = await ai.models.list({ config: { pageSize: 100 } });
      for await (const m of pager) {
        if (/flash/i.test(m.name ?? '')) names.push(m.name.replace(/^models\//, ''));
      }
    } catch {
      /* listing is best effort */
    }
    return { ok: false, status: err?.status, available: names };
  }
}
