' Run bin\Outpost_for_LAARES.exe with the arguments that were passed to this script,
' the working directory that contains this script and no visible window.

set FSO = CreateObject("Scripting.FileSystemObject")
my_folder = FSO.GetParentFolderName(Wscript.ScriptFullName)
' WScript.Echo my_folder

' Construct a command line as a string:
ReDim arguments(WScript.Arguments.Count)
arguments(0) = FSO.BuildPath(FSO.BuildPath(my_folder, "bin"), "Outpost_for_LAARES.exe")
For i = 0 To WScript.Arguments.Count-1
  If Len(WScript.Arguments(i)) = 0 Or InStr(WScript.Arguments(i), " ") > 0 Then
    arguments(i + 1) = Chr(34) & WScript.Arguments(i) & Chr(34)
  Else
    arguments(i + 1) = WScript.Arguments(i)
  End If
Next
command_line = Join(arguments)
' WScript.Echo command_line

' Set options for process creation:
set objWMIService = GetObject("winmgmts:{impersonationLevel=impersonate}!\\.\root\cimv2") 
set objStartup = objWMIService.Get("Win32_ProcessStartup")
set objConfig = objStartup.SpawnInstance_
objConfig.ShowWindow = 0

' Create process:
set process = GetObject("winmgmts:Win32_Process") 
result = process.Create(command_line, my_folder, objConfig, processid) 
If result <> 0 Then
  WScript.Echo "Error, process.Create(" & command_line & ") returned " & result
End If
