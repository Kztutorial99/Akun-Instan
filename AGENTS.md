# Architecture rules
- Catalog platform selection uses a validated query parameter on the existing catalog URL, so refresh and browser back restore the selected platform without changing hosting routes.
- Catalog navigation and banner visibility rules live in a small pure module with Node tests, so behavior can be verified without mounting the storefront.
- The WhatsApp bot (Baileys) lives in `wa-bot/` as a separate always-on Railway service, because Vercel functions cannot hold a persistent WhatsApp socket; the website reaches it only through the admin proxy in api/admin/settings.js (no new Vercel function files, to stay under the function limit).
- The Assistant, WhatsApp bot and YouTube draft AI all call OpenRouter through `api/_openrouter.js` (shared headers, free-model list, free-only check), so the provider is configured in one place and admins can only pick zero-cost models.
