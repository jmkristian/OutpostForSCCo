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

# This is meant to be interpreted by the Nullsoft scriptable install system http://nsis.sourceforge.net

Name "Los Altos ARES" "Outpost forms"
OutFile "OutpostForLAARES_Setup-0.4.exe"

Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

!include LogicLib.nsh
!include TextFunc.nsh

Var /GLOBAL OUTPOST_CODE
Var /GLOBAL OUTPOST_DATA
!define REG_SUBKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\OutpostForLAARES"

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
    StrCpy $INSTDIR "$APPDATA\OutpostForLAARES\"
    ${StrContainsSpace} $0 "$INSTDIR"
    ${If} $0 != false
      ReadEnvStr $0 SystemDrive
      StrCpy $INSTDIR "$0\OutpostForLAARES\"
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

# Set $OUTPOST_CODE = a folder that contains Outpost executables, and
# set $OUTPOST_DATA = a space-separated list of folders that contain Outpost configuration files.
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

  # Files to install:
  File launch.cmd
  File README.md
  SetOutPath "$INSTDIR\addons"
  File addons\*.launch
  SetOutPath "$INSTDIR\bin"
  File /r /x "*~" /x server-port.txt /x *.log bin\*
  SetOutPath "$INSTDIR\pack-it-forms"
  File /r /x "*~" /x .git* pack-it-forms\*
  File icon-*.png
  SetOutPath "$INSTDIR"

  # define uninstaller:
  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr   HKLM "${REG_SUBKEY}" DisplayName "Outpost for LAARES"
  WriteRegStr   HKLM "${REG_SUBKEY}" UninstallString "$\"$INSTDIR\uninstall.exe$\""
  WriteRegStr   HKLM "${REG_SUBKEY}" Publisher "Los Altos ARES"
  WriteRegStr   HKLM "${REG_SUBKEY}" URLInfoAbout "https://github.com/jmkristian/Outpost-for-LAARES/blob/master/README.md"
  WriteRegStr   HKLM "${REG_SUBKEY}" DisplayVersion "0.4"
  WriteRegDWORD HKLM "${REG_SUBKEY}" VersionMajor 0
  WriteRegDWORD HKLM "${REG_SUBKEY}" VersionMinor 4
  WriteRegDWORD HKLM "${REG_SUBKEY}" NoModify 1
  WriteRegDWORD HKLM "${REG_SUBKEY}" NoRepair 1
  WriteRegDWORD HKLM "${REG_SUBKEY}" EstimatedSize 15000

  ExecShellWait open "bin\launch.exe" "install$OUTPOST_DATA" SW_SHOWMINIMIZED
  ${If} ${Errors}
    Abort "bin\launch.exe install$OUTPOST_DATA failed"
  ${EndIf}

  CopyFiles "$OUTPOST_CODE\Aoclient.exe" "$INSTDIR\addons\Los_Altos\Aoclient.exe"

  # Execute a dry run, to encourage antivirus/firewall software to accept the new code.
  ExecShell open "bin\launch.exe" "dry-run" SW_SHOWMINIMIZED
  ${If} ${Errors}
    Abort "bin\launch.exe dry-run failed"
  ${EndIf}
SectionEnd

Section "Uninstall"
  SetOutPath "$INSTDIR"

  # Be sure to delete the uninstaller first.
  Delete "$INSTDIR\uninstall.exe"
  DeleteRegKey HKLM "${REG_SUBKEY}"

  # Remove our line from Outpost configuration files
  Call un.FindOutposts
  ExecShellWait open "bin\launch.exe" "uninstall$OUTPOST_DATA" SW_SHOWMINIMIZED

  Delete launch.cmd
  Delete README.md
  Delete *.log
  RMDir /r "$INSTDIR\addons"
  RMDir /r "$INSTDIR\bin"
  RMDir /r "$INSTDIR\pack-it-forms"
  RMDir "$INSTDIR" # Do nothing if the directory is not empty
SectionEnd
