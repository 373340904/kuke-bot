Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
nodePath = fso.BuildPath(scriptDir, "node.exe")
indexPath = fso.BuildPath(scriptDir, "index.js")
logPath = fso.BuildPath(scriptDir, "guard_log.txt")

Sub Log(msg)
    On Error Resume Next
    Set f = fso.OpenTextFile(logPath, 8, True)
    f.WriteLine Now & " " & msg
    f.Close
End Sub

Log "Guard started, dir=" & scriptDir

Do
    On Error Resume Next
    Set proc = GetObject("winmgmts:\\.\root\cimv2").ExecQuery("SELECT * FROM Win32_Process WHERE Name='node.exe'")
    If Err.Number <> 0 Then
        Log "WMI error: " & Err.Description
        Err.Clear
    ElseIf proc.Count = 0 Then
        Log "Bot offline, starting..."
        WshShell.CurrentDirectory = scriptDir
        WshShell.Run """" & nodePath & """ """ & indexPath & """", 0, False
        Log "Start command sent"
        WScript.Sleep 15000
    End If
    On Error GoTo 0
    WScript.Sleep 30000
Loop
