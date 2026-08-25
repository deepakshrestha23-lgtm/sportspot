Option Explicit

Dim shell
Dim fileSystem
Dim runnerPath
Dim command

Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

runnerPath = fileSystem.BuildPath( _
    fileSystem.GetParentFolderName(WScript.ScriptFullName), _
    "run_sportspot_maintenance_once.ps1" _
)

command = "PowerShell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File " _
    & Chr(34) & runnerPath & Chr(34)

' Run without creating an interactive console window, but keep the task result reliable.
shell.Run command, 0, True

Set fileSystem = Nothing
Set shell = Nothing
