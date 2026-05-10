# PreToolUse guard: block `git push` to remotes you don't want to push to
# (for example, a client-owned repo, a vendor fork, or a third-party mirror).
#
# Configure the blocklist via the BLOCKED_GIT_REMOTES env var (comma-separated
# remote names), or by editing $blockedRemotes below. Each entry is matched
# as a literal substring against the push command after `git push`.
#
# Outputs JSON to stdout with permissionDecision=deny when a match is found.

$ErrorActionPreference = 'SilentlyContinue'

$stdin = [Console]::In.ReadToEnd()
try {
    $payload = $stdin | ConvertFrom-Json
    $cmd = $payload.tool_input.command
} catch { exit 0 }

$blockedRemotes = if ($env:BLOCKED_GIT_REMOTES) {
    $env:BLOCKED_GIT_REMOTES -split ','
} else {
    @()  # e.g. @('client-github', 'vendor-fork')
}

foreach ($remote in $blockedRemotes) {
    $remote = $remote.Trim()
    if (-not $remote) { continue }
    if ($cmd -and $cmd -match "git\s+push\s+$([regex]::Escape($remote))") {
        $response = @{
            hookSpecificOutput = @{
                hookEventName = 'PreToolUse'
                permissionDecision = 'deny'
                permissionDecisionReason = "BLOCKED: pushing to '$remote' is not allowed by the harness guard. Use the approved deployment path instead."
            }
        } | ConvertTo-Json -Depth 5 -Compress
        Write-Output $response
        exit 0
    }
}

exit 0
