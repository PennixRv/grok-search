# Upstream Provenance

This repository is based on <https://github.com/BlueOcean223/grok-search> at
`1aab8105773ed53b5492a29f5f00400da63cdb9f` (2026-09-08), under its included
MIT `LICENSE`. The following five later upstream changes were reviewed against
that baseline; they were not imported as an undifferentiated sync:

| Upstream change | Disposition | Pennix treatment |
| --- | --- | --- |
| `4e9208fabf64e6d4588b25c3cd2918cca5164da3` | Adapted | Enforce a 45 KiB serialized JSON stdout budget and retain the complete response in the private output directory when truncation is needed. This is a Pennix CLI bound, not a Codex host limit. |
| `5d63a894ea740ee2024cbc30741d15e050a1fcf1` | Excluded | Paid agent-level benchmark was unnecessary for this upgrade and was not imported or run. |
| `82f024691ea49a58a39f1ce132ba0c9acb59d943` | Documentation adapted | Search once for the subquestion; fetch only when source text needs checking. Existing stopping rules and parent routing remain authoritative. |
| `f4afc41817f709aba3b5308359be89c1958ffab4` | Host example replaced | The Pi `{baseDir}` macro does not apply here. The existing dispatcher is exposed through the lifecycle-managed `grok-search` command; explicit file invocation remains available for diagnostics. |
| `73715b5af62b928c5764af201e8609c3fce6fa67` | Excluded | Benchmark-only changes were not imported or run. |

The Firecrawl provider and its dedicated cooldown implementation were removed
as a separate Pennix product decision. Tavily remains the only optional extra
search provider; Direct remains the keyless fetch/map fallback. The private
package is not published to npm.

The parent `pennix-skills` repository owns routing and installation policy;
this repository does not decide whether a question should use local evidence.
