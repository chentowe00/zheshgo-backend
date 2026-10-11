/* ZheshGo — runtime config for the AI assistant.
   Loaded BEFORE js/assistant.js on the assistant pages.
   assistantApiBase = base URL of the live AI backend (SAE Hong Kong).
   Leave "" for the static site's same-origin simulated mode.
   After SAE is deployed, set it to the SAE public HTTPS entry, e.g.
     "https://<your-custom-domain-or-alb-host>"
   (NO trailing slash, and NEVER put the API key here — the key lives only
   in the SAE environment variables / Secret.)
   See research/SAE香港部署操作指引.md for the full sequence. */
window.ZW_CONFIG = window.ZW_CONFIG || {};
window.ZW_CONFIG.assistantApiBase = ""; // TODO: set to SAE HTTPS URL after deploy
