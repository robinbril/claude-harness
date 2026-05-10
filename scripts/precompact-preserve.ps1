# PreCompact hook: preserve critical context before auto-compaction
# Writes a snapshot of files-in-play + cwd to memory dir so session-recall picks it up

$ErrorActionPreference = 'SilentlyContinue'

$stdin = [Console]::In.ReadToEnd()
$payload = $null
try { $payload = $stdin | ConvertFrom-Json } catch {}

$cwd = if ($payload.cwd) { $payload.cwd } else { (Get-Location).Path }
$trigger = if ($payload.trigger) { $payload.trigger } else { 'unknown' }
$sessionId = if ($payload.session_id) { $payload.session_id } else { 'unknown' }

# Memory snapshot directory. Override via CLAUDE_MEMORY_DIR if your project
# slug differs; otherwise we fall back to a sensible default under ~/.claude.
$memDir = if ($env:CLAUDE_MEMORY_DIR) { $env:CLAUDE_MEMORY_DIR } else { Join-Path $HOME '.claude/projects/memory' }
if (-not (Test-Path $memDir)) { New-Item -ItemType Directory -Force -Path $memDir | Out-Null }
$snapshotFile = Join-Path $memDir 'precompact_snapshot.md'

$timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
$folder = Split-Path -Leaf $cwd

$content = @"
---
name: Pre-compact snapshot
description: Last session state captured just before compaction — use to re-orient after compact
type: project
---

# Pre-compact snapshot — $timestamp

**Session:** $sessionId
**Trigger:** $trigger
**Working directory:** ``$cwd``
**Project folder:** $folder

## Why this exists
Auto-compact drops detail. If you're reading this right after a compact, check git status and recent edits to re-orient rather than trusting the summary alone.
"@

Set-Content -Path $snapshotFile -Value $content -Encoding UTF8

# Toast notification so the user is aware compaction is about to happen
try {
    [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime]
    [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime]

    $xml = @"
<toast>
  <visual><binding template="ToastGeneric">
    <text>Context compaction ($trigger)</text>
    <text>$folder</text>
    <text placement="attribution">snapshot saved</text>
  </binding></visual>
  <audio src="ms-winsoundevent:Notification.Reminder" />
</toast>
"@
    $doc = New-Object Windows.Data.Xml.Dom.XmlDocument
    $doc.LoadXml($xml)
    $toast = [Windows.UI.Notifications.ToastNotification]::new($doc)
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Claude Code').Show($toast)
} catch {}
