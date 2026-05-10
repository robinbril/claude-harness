# Claude Code Stop hook: Windows 11 toast + sound when Claude finishes responding
# Reads cwd from hook stdin JSON, falls back to current location

$ErrorActionPreference = 'SilentlyContinue'

# Read hook stdin (JSON) to extract cwd
$cwd = ''
try {
    $stdin = [Console]::In.ReadToEnd()
    if ($stdin) {
        $payload = $stdin | ConvertFrom-Json
        if ($payload.cwd) { $cwd = $payload.cwd }
    }
} catch {}

if (-not $cwd) { $cwd = (Get-Location).Path }
$folderName = Split-Path -Leaf $cwd

# Windows 11 native toast via Windows Runtime
try {
    [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime]
    [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime]

    $xmlString = @"
<toast activationType="protocol" launch="file:///$($cwd -replace '\\','/')">
  <visual>
    <binding template="ToastGeneric">
      <text>Claude is klaar</text>
      <text>$folderName</text>
      <text placement="attribution">Claude Code</text>
    </binding>
  </visual>
  <audio src="ms-winsoundevent:Notification.Default" />
</toast>
"@

    $xmlDoc = New-Object Windows.Data.Xml.Dom.XmlDocument
    $xmlDoc.LoadXml($xmlString)
    $toast = [Windows.UI.Notifications.ToastNotification]::new($xmlDoc)
    $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Claude Code')
    $notifier.Show($toast)
} catch {
    # Fallback: balloon tip + system sound
    try {
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        $icon = New-Object System.Windows.Forms.NotifyIcon
        $icon.Icon = [System.Drawing.SystemIcons]::Information
        $icon.BalloonTipTitle = 'Claude is klaar'
        $icon.BalloonTipText = $folderName
        $icon.Visible = $true
        $icon.ShowBalloonTip(4000)
        Start-Sleep -Milliseconds 200
        [System.Media.SystemSounds]::Asterisk.Play()
    } catch {}
}
