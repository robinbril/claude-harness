# PostToolUse hook: after az containerapp update/create, verify latest revision is Running
# Triggers toast warning if deploy failed silently

$ErrorActionPreference = 'SilentlyContinue'

$stdin = [Console]::In.ReadToEnd()
try {
    $payload = $stdin | ConvertFrom-Json
    $cmd = $payload.tool_input.command
} catch { exit 0 }

# Only fire on containerapp deploys (update/create, not logs/show/exec)
if (-not $cmd -or $cmd -notmatch 'az\s+containerapp\s+(update|create)') { exit 0 }

# Extract --name and --resource-group from the command
$appName = $null
$rg = $null
if ($cmd -match '--name\s+"?([^\s"]+)') { $appName = $Matches[1] }
if ($cmd -match '--resource-group\s+"?([^\s"]+)') { $rg = $Matches[1] }
if (-not $appName -or -not $rg) { exit 0 }

$az = 'C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd'
if (-not (Test-Path $az)) { $az = 'az' }

# Give the new revision a few seconds to materialize
Start-Sleep -Seconds 10

try {
    $json = & $az containerapp revision list --name $appName --resource-group $rg --query "[?properties.active].{name:name,state:properties.runningState,replicas:properties.replicas}" -o json 2>$null
    if (-not $json) { exit 0 }
    $revs = $json | ConvertFrom-Json
    $broken = $revs | Where-Object { $_.state -ne 'Running' }
    if ($broken) {
        $msg = ($broken | ForEach-Object { "$($_.name): $($_.state)" }) -join ', '
        $xml = @"
<toast>
  <visual><binding template="ToastGeneric">
    <text>Deploy WARNING: $appName</text>
    <text>$msg</text>
    <text placement="attribution">fix voordat je commit</text>
  </binding></visual>
  <audio src="ms-winsoundevent:Notification.Looping.Alarm" loop="false" />
</toast>
"@
        try {
            [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime]
            $doc = New-Object Windows.Data.Xml.Dom.XmlDocument
            $doc.LoadXml($xml)
            $toast = [Windows.UI.Notifications.ToastNotification]::new($doc)
            [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Claude Code').Show($toast)
        } catch {}

        @{
            hookSpecificOutput = @{
                hookEventName = 'PostToolUse'
                additionalContext = "WAARSCHUWING: ACA revision op $appName is niet Running: $msg. Niet commiten tot gefixed."
            }
        } | ConvertTo-Json -Depth 5 -Compress | Write-Output
    }
} catch {}

exit 0
