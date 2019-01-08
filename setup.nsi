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
!define VersionMinor 11

OutFile "${SetupFileName}_Setup-${VersionMajor}.${VersionMinor}.exe"

RequestExecutionLevel highest
Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

!include LogicLib.nsh
!include TextFunc.nsh
!include WinVer.nsh

Var /GLOBAL OUTPOST_CODE
Var /GLOBAL OUTPOST_DATA
Var /GLOBAL AOCLIENT_EXE
Var /GLOBAL WSCRIPT_EXE

Function .onInit
  ${If} $INSTDIR == ""
    ReadEnvStr $0 SystemDrive
    StrCpy $INSTDIR "$0\${INSTDIR_NAME}\"
  ${EndIf}
FunctionEnd

Function FindOutpost
  Exch $R0
  Push $R1
  ClearErrors
  ReadINIStr $R1 "$R0\Outpost.conf" DataDirectory DataDir
  ${IfNot} ${Errors}
    ${If} "$AOCLIENT_EXE" == ""
      ${If} ${FileExists} "$R0\Aoclient.exe"
        StrCpy $AOCLIENT_EXE "$R0\Aoclient.exe"
      ${EndIf}
    ${EndIf}
    StrCpy $OUTPOST_CODE "$OUTPOST_CODE $\"$R0$\""
    StrCpy $OUTPOST_DATA "$OUTPOST_DATA $\"$R1$\""
  ${EndIf}
  ClearErrors
  Pop $R1
  Pop $R0
FunctionEnd

Function un.FindOutpost
  Exch $R0
  Push $R1
  ClearErrors
  ReadINIStr $R1 "$R0\Outpost.conf" DataDirectory DataDir
  ${IfNot} ${Errors}
    StrCpy $OUTPOST_CODE "$OUTPOST_CODE $\"$R0$\""
    StrCpy $OUTPOST_DATA "$OUTPOST_DATA $\"$R1$\""
  ${EndIf}
  ClearErrors
  Pop $R1
  Pop $R0
FunctionEnd

!macro Delete NAME
  IfFileExists `${NAME}` 0 +5
  Delete `${NAME}`
  IfFileExists `${NAME}` 0 +3
  SetErrors
  DetailPrint `Can't delete ${NAME}`
!macroend
!define Delete '!insertmacro "Delete"'

!macro RMDir NAME
  IfFileExists `${NAME}` 0 +5
  RMDir /r `${NAME}`
  IfFileExists `${NAME}` 0 +3
  SetErrors
  DetailPrint `Can't remove ${NAME}`
!macroend
!define RMDir '!insertmacro "RMDir"'

!macro defineGlobalFunctions un
# Set $OUTPOST_DATA = a space-separated list of folders that contain Outpost configuration files.
# If no such folders are found, set it to "".
Function ${un}FindOutposts
  StrCpy $OUTPOST_CODE ""
  StrCpy $OUTPOST_DATA ""
  Push "$PROGRAMFILES\SCCo Packet"
  Call ${un}FindOutpost
  ${If} "$PROGRAMFILES64" != "$PROGRAMFILES"
    Push "$PROGRAMFILES64\SCCo Packet"
    Call ${un}FindOutpost
  ${EndIf}
  Push "$PROGRAMFILES\Outpost"
  Call ${un}FindOutpost
  ${If} "$PROGRAMFILES64" != "$PROGRAMFILES"
    Push "$PROGRAMFILES64\Outpost"
    Call ${un}FindOutpost
  ${EndIf}
FunctionEnd

Function ${un}IsUserAdmin
  Push $R0
  Push $R1
  StrCpy $R0 true
  ClearErrors
  UserInfo::GetName
  ${If} ${Errors}
    # This is Windows 9x. Every user is an admin.
  ${Else}
    Pop $R1
    UserInfo::GetAccountType
    Pop $R1
    ${If} "$R1" == ""
      # This is Windows 9x. Every user is an admin.
    ${ElseIf} "$R1" == "Admin"
      # This user is an admin.
    ${Else}
      StrCpy $R0 false
    ${EndIf}
  ${EndIf}
  Pop $R1
  Exch $R0
FunctionEnd

Function ${un}DeleteMyFiles
  Push $R0
  Push $R1
  ClearErrors
  ${Delete} browse.cmd
  ${Delete} launch.vbs
  ${Delete} launch.cmd
  ${Delete} launch-v.cmd
  ${Delete} README.*
  ${Delete} uninstall.exe
  ${RMDir} "$INSTDIR\addons"
  ${RMDir} "$INSTDIR\bin"
  ${RMDir} "$INSTDIR\logs"
  ${RMDir} "$INSTDIR\pack-it-forms"
  ${If} ${Errors}
    StrCpy $R0 "Some files were not deleted from $INSTDIR."
    Call ${un}IsUserAdmin
    Pop $R1
    ${If} $R1 != true
      StrCpy $R0 "$R0 To delete them, run this ${un}installer again as an administrator."
    ${EndIf}
    MessageBox MB_OK|MB_ICONEXCLAMATION "$R0" /SD IDOK
  ${EndIf}
  Pop $R1
  Pop $R0
FunctionEnd
!macroend
!insertmacro defineGlobalFunctions ""
!insertmacro defineGlobalFunctions "un."

Section "Install"
  # Where to install files:
  CreateDirectory "$INSTDIR"
  SetOutPath "$INSTDIR"

  Call FindOutposts
  ${If} "$OUTPOST_DATA" == ""
    MessageBox MB_OK|MB_ICONSTOP "Please install Outpost Packet Message Manager before you install ${DisplayName}. No recent version is installed, it appears."
    Abort "Outpost PMM not found."
  ${EndIf}

  # Stop the server (so it will release its lock on bin\Outpost_Forms.exe):
  ExecShellWait open "bin\Outpost_Forms.exe" "stop" SW_SHOWMINIMIZED
  Call DeleteMyFiles

  CreateDirectory "$INSTDIR\addons\${addon_name}"
  ${If} "$AOCLIENT_EXE" == ""
    MessageBox MB_OK|MB_ICONSTOP "${DisplayName} won't work, because there's no Aoclient.exe file in $OUTPOST_DATA. A newer version of Outpost should have this file."
    Abort "No Aoclient.exe in $OUTPOST_DATA."
  ${Else}
    DetailPrint "Copy from $AOCLIENT_EXE"
    ClearErrors
    CopyFiles "$AOCLIENT_EXE" "$INSTDIR\addons\${addon_name}\Aoclient.exe"
    ${If} ${Errors}
      MessageBox MB_OK|MB_ICONSTOP "Can't copy $AOCLIENT_EXE."
      Abort "Can't copy $AOCLIENT_EXE."
    ${EndIf}
  ${EndIf}

  # Files to install:
  File browse.cmd
  File launch.vbs
  File launch.cmd
  File launch-v.cmd
  File README.html
  SetOutPath "$INSTDIR\addons"
  File addons\${addon_name}.launch
  SetOutPath "$INSTDIR\bin"
  File /r /x "*~" /x server-port.txt /x *.log bin\*
  SetOutPath "$INSTDIR\pack-it-forms"
  File /r /x "*~" /x .git* pack-it-forms\*
  File icon-*.png
  SetOutPath "$INSTDIR"

  # define uninstaller:
  WriteUninstaller "$INSTDIR\uninstall.exe"
  ClearErrors
  WriteRegStr   HKLM "${REG_SUBKEY}" DisplayName "${DisplayName}"
  WriteRegStr   HKLM "${REG_SUBKEY}" UninstallString "$\"$INSTDIR\uninstall.exe$\""
  ${If} ${Errors}
    DetailPrint "not registered"
    StrCpy $0 "${DisplayName} wasn't registered with Windows as a program."
    Call IsUserAdmin
    Pop $1
    ${If} $1 != true
      StrCpy $0 "$0 To register it, run this installer again as an administrator."
    ${EndIf}
    StrCpy $0 "$0 To uninstall it, run the uninstall.exe program in $INSTDIR\."
    MessageBox MB_OK|MB_ICONEXCLAMATION "$0" /SD IDOK
  ${EndIf}
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

  ClearErrors
  ExecShellWait open "bin\Outpost_Forms.exe" "install $WSCRIPT_EXE$OUTPOST_DATA" SW_SHOWMINIMIZED
  ${If} ${Errors}
    Abort "install failed"
  ${EndIf}

  # Execute a dry run, to encourage antivirus/firewall software to accept the new code.
  ClearErrors
  ${If} ${AtMostWinXP}
    ExecShellWait open              ".\launch.cmd" "dry-run" SW_SHOWMINIMIZED
  ${Else}
    ExecShellWait open "$WSCRIPT_EXE" ".\launch.vbs dry-run" SW_SHOWMINIMIZED
  ${EndIf}
  ${If} ${Errors}
    Abort "dry-run failed"
  ${EndIf}
SectionEnd

Section "Uninstall"
  SetOutPath "$INSTDIR"

  # Be sure to delete the uninstaller first.
  ${Delete} "$INSTDIR\uninstall.exe"
  DeleteRegKey HKLM "${REG_SUBKEY}"

  # Remove our line from Outpost configuration files
  Call un.FindOutposts
  ExecShellWait open "bin\Outpost_Forms.exe" "uninstall$OUTPOST_DATA" SW_SHOWMINIMIZED

  Call un.DeleteMyFiles
  RMDir "$INSTDIR" # Do nothing if the directory is not empty
SectionEnd
