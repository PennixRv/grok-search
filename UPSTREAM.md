# Upstream Provenance

Synced from <https://github.com/BlueOcean223/grok-search> at
`1aab8105773ed53b5492a29f5f00400da63cdb9f` (2026-09-08), under its included
MIT `LICENSE`.

Pennix keeps the upstream provider implementations and tests, changes the
default extra-source count to `0`, runs explicitly requested extra providers
after the Grok request, and exposes the `grok-search` executable dispatcher.
The parent `pennix-skills` repository owns routing and installation policy;
this repository does not decide whether a question should use local evidence.
