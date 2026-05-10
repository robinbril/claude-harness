# Customise the banner with your own ASCII art / name / org. This file is
# sourced by the terminal-signature hook to print a header on shell start.

$accent = "$([char]27)[38;2;41;128;185m"
$dim    = "$([char]27)[38;2;130;140;150m"
$reset  = "$([char]27)[0m"

Write-Host ""
Write-Host "${accent}  Claude Code Harness${reset}"
Write-Host "${dim}    $(Get-Date -Format 'dddd d MMMM yyyy, HH:mm')${reset}"
Write-Host ""
