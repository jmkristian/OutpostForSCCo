# Copyright 2018 by John Kristian
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

!define VersionMajor 1
!define VersionMinor 1

OutFile "${SetupFileName}_Setup-${VersionMajor}.${VersionMinor}.exe"

Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

!include LogicLib.nsh
!include TextFunc.nsh
!include WinVer.nsh

Var /GLOBAL OUTPOST_CODE
Var /GLOBAL OUTPOST_DATA
Var /GLOBAL WSCRIPT_EXE

Function StrContainsSpace
  Pop $0
  loop:
    ${If} $0 == ""
      Push false
      Return
    ${Endif}
    StrCpy $1 $0 1 0
    ${If} $1 == " "
      Push true
      Return
    ${Endif}
    StrLen $1 $0
    StrCpy $0 $0 $1 1
    GoTo loop
FunctionEnd
!macro StrContainsSpace OUT S
  Push `${S}`
  Call StrContainsSpace
  Pop `${OUT}`
!macroend
!define StrContainsSpace '!insertmacro "StrContainsSpace"'

Function .onInit
  ${If} $INSTDIR == ""
    StrCpy $INSTDIR "$APPDATA\${INSTDIR_NAME}\"
    ${StrContainsSpace} $0 "$INSTDIR"
    ${If} $0 != false
      ReadEnvStr $0 SystemDrive
      StrCpy $INSTDIR "$0\${INSTDIR_NAME}\"
    ${EndIf}
  ${EndIf}
FunctionEnd

!macro defineFindOutposts un
Function ${un}FindOutpost
  Pop $0
  ClearErrors
  ReadINIStr $1 "$0\Outpost.conf" DataDirectory DataDir
  ${IfNot} ${Errors}
    StrCpy $OUTPOST_CODE "$0"
    StrCpy $OUTPOST_DATA "$OUTPOST_DATA $\"$1$\""
  ${EndIf}
FunctionEnd

# Set $OUTPOST_CODE = a folder that contains Outpost executables.
# Set $OUTPOST_DATA = a space-separated list of folders that contain Outpost configuration files.
# If no such folders are found, set both variables to "".
# If Outpost and SCCo Packet are both installed, $OUTPOST_CODE will be SCCo Packet.
Function ${un}FindOutposts
  StrCpy $OUTPOST_CODE ""
  Push "$PROGRAMFILES\Outpost"
  Call ${un}FindOutpost
  ${If} "$PROGRAMFILES64" != "$PROGRAMFILES"
    Push "$PROGRAMFILES64\Outpost"
    Call ${un}FindOutpost
  ${EndIf}
  Push "$PROGRAMFILES\SCCo Packet"
  Call ${un}FindOutpost
  ${If} "$PROGRAMFILES64" != "$PROGRAMFILES"
    Push "$PROGRAMFILES64\SCCo Packet"
    Call ${un}FindOutpost
  ${EndIf}
FunctionEnd
!macroend
!insertmacro defineFindOutposts ""
!insertmacro defineFindOutposts "un."

!macro defineDeleteMyFiles un
Function ${un}DeleteMyFiles
  Delete launch.vbs
  Delete launch.cmd
  Delete launch-v.cmd
  Delete README.*
  RMDir /r "$INSTDIR\addons"
  RMDir /r "$INSTDIR\bin"
  RMDir /r "$INSTDIR\pack-it-forms"
FunctionEnd
!macroend
!insertmacro defineDeleteMyFiles ""
!insertmacro defineDeleteMyFiles "un."

Section "Install"
  StrCpy $OUTPOST_DATA ""
  Call FindOutposts
  ${If} "$OUTPOST_DATA" == ""
    MessageBox MB_OK "Outpost Packet Message Manager isn't installed, it appears. Please install it before installing this software."
    Abort "Please install Outpost PMM first."
  ${EndIf}

  # Where to install files:
  CreateDirectory "$INSTDIR"
  SetOutPath "$INSTDIR"

  # Stop the server (so it will release its lock on bin\Outpost_Forms.exe):
  ExecShellWait open "bin\Outpost_Forms.exe" "stop" SW_SHOWMINIMIZED
  Call DeleteMyFiles
  ClearErrors

  # Files to install:
  File launch.vbs
  File launch.cmd
  File launch-v.cmd
  File README.html
  SetOutPath "$INSTDIR\addons"
  File addons\${ADDON_NAME}.launch
  SetOutPath "$INSTDIR\bin"
  File /r /x "*~" /x server-port.txt /x *.log bin\*
  SetOutPath "$INSTDIR\pack-it-forms"
  File /r /x "*~" /x .git* pack-it-forms\*
  File icon-*.png
  SetOutPath "$INSTDIR"

  # define uninstaller:
  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr   HKLM "${REG_SUBKEY}" DisplayName "${DisplayName}"
  WriteRegStr   HKLM "${REG_SUBKEY}" UninstallString "$\"$INSTDIR\uninstall.exe$\""
  WriteRegStr   HKLM "${REG_SUBKEY}" Publisher "Los Altos ARES"
  WriteRegStr   HKLM "${REG_SUBKEY}" URLInfoAbout "https://github.com/jmkristian/OutpostforLAARES/blob/master/README.md"
  WriteRegStr   HKLM "${REG_SUBKEY}" DisplayVersion "${VersionMajor}.${VersionMinor}"
  WriteRegDWORD HKLM "${REG_SUBKEY}" VersionMajor ${VersionMajor}
  WriteRegDWORD HKLM "${REG_SUBKEY}" VersionMinor ${VersionMinor}
  WriteRegDWORD HKLM "${REG_SUBKEY}" NoModify 1
  WriteRegDWORD HKLM "${REG_SUBKEY}" NoRepair 1
  WriteRegDWORD HKLM "${REG_SUBKEY}" EstimatedSize 15000

  StrCpy $WSCRIPT_EXE "$SYSDIR\wscript.exe"
  IfFileExists $WSCRIPT_EXE +2
    StrCpy $WSCRIPT_EXE "$WINDIR\System\wscript.exe"

  ExecShellWait open "bin\Outpost_Forms.exe" "install $WSCRIPT_EXE$OUTPOST_DATA" SW_SHOWMINIMIZED
  ${If} ${Errors}
    Abort "bin\Outpost_Forms.exe install$OUTPOST_DATA failed"
  ${EndIf}

  CopyFiles "$OUTPOST_CODE\Aoclient.exe" "$INSTDIR\addons\${ADDON_NAME}\Aoclient.exe"

  # Execute a dry run, to encourage antivirus/firewall software to accept the new code.
  ${If} ${AtMostWinXP}
    ExecShellWait open              ".\launch.cmd" "dry-run" SW_SHOWMINIMIZED
  ${Else}
    ExecShellWait open "$WSCRIPT_EXE" ".\launch.vbs dry-run" SW_SHOWMINIMIZED
  ${EndIf}
  ${If} ${Errors}
    Abort "launch dry-run failed"
  ${EndIf}
SectionEnd

Section "Uninstall"
  SetOutPath "$INSTDIR"

  # Be sure to delete the uninstaller first.
  Delete "$INSTDIR\uninstall.exe"
  DeleteRegKey HKLM "${REG_SUBKEY}"

  # Remove our line from Outpost configuration files
  Call un.FindOutposts
  ExecShellWait open "bin\Outpost_Forms.exe" "uninstall$OUTPOST_DATA" SW_SHOWMINIMIZED

  Call un.DeleteMyFiles
  RMDir /r "$INSTDIR\logs"
  RMDir "$INSTDIR" # Do nothing if the directory is not empty
SectionEnd
