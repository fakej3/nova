# Model providers

Providers are adapters behind `WulanAIGateway`. The core never calls a vendor SDK directly.

## Gemini

`createGeminiProvider({ apiKey })` provides generation and embeddings using the Gemini REST API. Register it with `registerProvider(core, provider)`.

The provider is intentionally optional: if `GEMINI_API_KEY` is absent, it reports itself as unconfigured instead of pretending that a model is available.
