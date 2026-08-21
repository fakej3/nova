# Neural substrate v2

Wulan's associative neural layer now supports:

- temporal decay with a 7-day half-life
- signed feedback learning for accepted/corrected/rejected/preferences
- multi-hop spreading activation across up to three hops
- confidence-aware agent routing
- bounded consolidation and pruning
- persisted neural state through `WulanLocalPersistence`

This remains an associative learning substrate, not a claim that Wulan is retraining Gemini locally.
