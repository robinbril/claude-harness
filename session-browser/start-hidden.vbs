Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "node """ & WshShell.ExpandEnvironmentStrings("%USERPROFILE%") & "\.claude\scripts\session-browser\server.mjs"" --silent", 0, False
