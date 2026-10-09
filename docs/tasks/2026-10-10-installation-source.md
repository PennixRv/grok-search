# Clarify the Skill installation source

This direct documentation task implements the `grok-search` change in the approved root task `consumer-update-agents-recheck` revision 4.

The Skill previously referred to an unspecified “Pennix installer”. Name `pennix-workflow-lifecycle`, its catalog-defined `replace-staged` operation, and the managed `~/.local/bin` command link instead. Preserve native Grok invocation, provider configuration, and all runtime behavior.

Scope: `SKILL.md` and this record. Verify the text against the lifecycle collection contract, run `git diff --check`, commit and push the source change, then update the exact source commit in the `pennix-skills` collection catalog and snapshot. No runtime release is needed for this wording change.

Verification: the named catalog operation prepares the production dependency and
manages the command link as documented; `git diff --check` passed. Runtime code,
provider settings and package version are unchanged. Delivery uses the existing
main branch; the parent task records the pushed commit and snapshot verification.
