' Run {{PROGRAM_PATH}} with the arguments that were passed to this script,
' the working directory that contains this script and no visible window.

set FSO = CreateObject("Scripting.FileSystemObject")
my_folder = FSO.GetParentFolderName(FSO.GetParentFolderName(Wscript.ScriptFullName))
' WScript.Echo my_folder

' Construct a command line as a string:
ReDim arguments(WScript.Arguments.Count)
arguments(0) = FSO.BuildPath(my_folder, "{{PROGRAM_PATH}}")
For i = 0 To WScript.Arguments.Count-1
  arg = WScript.Arguments(i)
  If Len(arg) = 0 Or InStr(arg, " ") > 0 Or InStr(arg, Chr(34)) > 0 Then
    arg = Chr(34) & replace(arg, Chr(34), Chr(34) & Chr(34)) & Chr(34)
  End If
  arguments(i + 1) = arg
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
