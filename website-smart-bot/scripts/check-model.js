// Confirms the configured model identifier exists for the API key. This calls the model metadata
// endpoint, not generateContent, so it does not use the per-minute or daily request allowance
// in the way a chat message does.
import { loadConfig, loadEnvFile } from '../src/config.js';
import { verifyModel } from '../src/llm.js';

loadEnvFile();
const config = loadConfig();
if (!config.gemini.apiKey) {
  console.error('GEMINI_API_KEY is not set in website-smart-bot/.env. Nothing was checked.');
  process.exit(2);
}
const result = await verifyModel(config);
if (result.ok) {
  console.log(`Model "${config.gemini.model}" is available for this API key (${result.name}).`);
} else {
  console.error(`Model "${config.gemini.model}" was not confirmed for this API key (status ${result.status ?? 'unknown'}).`);
  if (result.available.length) console.error(`Flash models this key can see:\n  ${result.available.join('\n  ')}\nSet GEMINI_MODEL to one of these.`);
  process.exit(1);
}
