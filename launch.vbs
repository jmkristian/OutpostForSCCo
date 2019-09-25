' Run {{PROGRAM_PATH}} with the arguments that were passed to this script,
' the working directory that contains this script and no visible window.

set FSO = CreateObject("Scripting.FileSystemObject")
my_folder = FSO.GetParentFolderName(FSO.GetParentFolderName(Wscript.ScriptFullName))
' WScript.Echo my_folder

' Construct a command line as a string:
ReDim arguments(WScript.Arguments.Count)
arguments(0) = Chr(34) & FSO.BuildPath(my_folder, "{{PROGRAM_PATH}}") & Chr(34)
For i = 0 To WScript.Arguments.Count-1
  arg = WScript.Arguments(i)
  If Len(arg) = 0 Or InStr(arg, " ") > 0 Or InStr(arg, Chr(34)) > 0 Then
    arg = Chr(34) & replace(arg, Chr(34), Chr(34) & Chr(34)) & Chr(34)
  End If
  arguments(i + 1) = arg
Next
command_line = Join(arguments)
' WScript.Echo command_line

' Create process:
On Error Resume Next
set shell = WScript.CreateObject("WScript.Shell")
shell.CurrentDirectory = my_folder
result = shell.Run(command_line, vbHide, true)
If Err.Number <> 0 Then
  Call MsgBox("Error " & Err.Number & " from WScript.Shell.Run " & command_line, vbOKOnly + vbExclamation)
  WScript.Quit Err.Number
ElseIf result <> 0 Then
  Call MsgBox("Error " & result & " from " & command_line, vbOKOnly + vbExclamation)
  WScript.Quit result
End If
