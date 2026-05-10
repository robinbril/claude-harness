# Lessons Learned

Prevention rules based on repeated mistakes. Each entry: what to do, and why.

This file is a template. Add your own entries as you accumulate gotchas. The examples
below illustrate the format and the kind of content that belongs here.

## Shell & Cross-platform

- **PowerShell for Windows-native CLIs**: prefer `powershell -File script.ps1` or a PowerShell heredoc over bash on Windows. Reason: bash on Windows mis-parses things like `$var =` and `& cmd`.
- **Multiline strings: always via a script file**: `powershell.exe -Command @"..."@` chokes on the heredoc form. Write to a temp `.ps1` and run with `powershell.exe -File`. Reason: repeatedly fails when used inline for git commit messages.

## Docker

- **`--platform linux/amd64` when targeting x86 cloud runtimes**: Apple Silicon and ARM hosts build ARM images by default. If the target host is x86, the container crashes silently. Always pin the platform.

## Cloud Deployment

- **Verify the deployed revision after pushing**: check status (e.g. `az containerapp revision list`, `kubectl rollout status`) after every deploy. A bad container can start silently; committing on top of a broken deploy is technical debt.
- **Verify which branch is actually deployed before hotfixing**: never assume `main` or `develop` is what runs in production. Check the image tag or CI history. Reason: hotfixes applied to the wrong branch produce no visible effect.

## Regex

- **Word boundary `\b` and underscore**: in most regex flavors `_` is a word character. `\bID-(\d+)\b` fails on `ID-123_extra.pdf` because `\b` sits between `3` and `_` (both word chars). Use a negative lookahead like `(?!\w)` when the match can be followed by `_`.
- **Lookahead to require at least one digit**: to avoid matching `Order Reference here`, use `(?=[A-Z0-9-]*\d)[A-Z0-9-]{4,}` — the lookahead guarantees a digit somewhere in the match.

## Model IDs

- **Validate model IDs before deploy**: invented IDs return 400s. Keep a list of currently valid model identifiers in config and validate at startup. Reason: silent failure in containers is hard to debug.

## Prompts & LLM

- **Don't shorten system prompts for performance**: enrich and clarify instead. Output quality scales with prompt completeness, not brevity.

## Python code quality

- **No imports inside functions**: `from module import x` inside a function body hides dependencies and runs on every call. Top-of-file imports only.
- **No nested helper functions if they need tests**: helpers nested inside another function can't be imported by pytest. Put them at module level.

## Cloud Auth

- **ARM and Graph tokens expire independently**: `az containerapp` can work while `az ad` fails. Separate OAuth scopes; conditional access applies per resource.
- **Prefer PKCE authorization code flow over device code**: many tenants flag device code authentication as a phishing risk and trigger security alerts. Use PKCE with a browser loopback redirect and your own tenant app registration.

## Credentials hygiene

- **No credentials in markdown docs that go to git**: pull tokens, API keys, certificates do not belong in docs, even in "internal" files like cluster-info or handover docs. Share via secret managers or DM. Reason: code review tooling routinely catches live tokens committed to docs.

## Git push safety

- **Check `git remote -v` before every push**: if the remote points to a repo you don't own (client repo, vendor repo, third-party fork), do not push. Maintain a guard hook (see `scripts/guard-git-push.ps1`) that blocks pushes to disallowed remotes.

## Manifests & Schemas

- **Validate manifest schemas before upload**: tool stores (Teams Admin Center, Chrome Web Store, etc.) often return generic "can't read manifest" errors for schema violations. Validate locally against the published JSON schema first.
- **Cross-tool zip compatibility**: some upload targets reject zips produced by certain tools. Prefer Python's `zipfile` over platform-specific archivers when the target is picky.

## Kustomize

- **Base and overlays in separate directories**: a base `kustomization.yaml` must not live in the same directory as the overlay parent. Create `k8s/base/` and keep all base manifests there.
- **Resources must live within or below the base directory**: `../../foo.yaml` references from `k8s/base/` are blocked by kustomize security.

## Document deliverables

- **Use rich formats for client deliverables**: analyses, summaries, questionnaires belong in `.docx` (or PDF), not plain text. Only raw transcripts stay as `.txt`.
- **python-docx: format markers + parser, not line-by-line**: dump every input line as a separate paragraph and you get an unreadable Word doc. Use format markers (TITLE:, H1:, BULLET:) in content files and a parser that accumulates body paragraphs.
