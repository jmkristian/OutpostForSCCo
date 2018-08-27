rem Run bin/launch.exe with the arguments that were passed to this script,
rem the working directory that contains this script and no visible window.

set fso = CreateObject("Scripting.FileSystemObject")
my_folder = fso.GetParentFolderName(Wscript.ScriptFullName)
rem WScript.Echo my_folder

rem Construct a command line as a string:
ReDim arguments(WScript.Arguments.Count)
arguments(0) = fso.BuildPath(fso.BuildPath(my_folder, "bin"), "launch.exe")
For i = 0 To WScript.Arguments.Count-1
  If InStr(WScript.Arguments(i), " ") > 0 Then
    arguments(i + 1) = Chr(34) & WScript.Arguments(i) & Chr(34)
  Else
    arguments(i + 1) = WScript.Arguments(i)
  End If
Next
command_line = Join(arguments)
rem WScript.Echo command_line

rem Set options for process creation:
set objWMIService = GetObject("winmgmts:{impersonationLevel=impersonate}!\\.\root\cimv2") 
Set objStartup = objWMIService.Get("Win32_ProcessStartup")
Set objConfig = objStartup.SpawnInstance_
objConfig.ShowWindow = 0

rem Create process:
set process = GetObject("winmgmts:Win32_Process") 
result = process.Create(command_line, my_folder, objConfig, processid) 
If result <> 0 Then
  WScript.Echo "Error, process.Create(" & command_line & ") returned " & result
End If
