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
!define VersionMinor 12

Name "${WINDOW_TITLE}" "web forms"
OutFile "${SetupFileName}_Setup-${VersionMajor}.${VersionMinor}.exe"

RequestExecutionLevel highest
Page custom selectOutpostCode "" "${WINDOW_TITLE} Setup"
Page directory ifOutpostDataDefined
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

!include LogicLib.nsh
!include nsDialogs.nsh
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

Function selectOutpostCode
  Call FindOutposts
  ${If} "$OUTPOST_DATA" != ""
    Abort # that is, don't ask the user to select a folder.
  ${EndIf}

  Push $R0
  nsDialogs::SelectFolderDialog "Where is Outpost installed? Select the folder that contains Outpost.conf. ${addon_name} forms will be added to the Outpost you select." "C:\Program Files (x86)"
  Pop $R0
  ${If} "$R0" != error
    Push $R0
    Call FindOutpost
  ${EndIf}
  Pop $R0
FunctionEnd

Function ifOutpostDataDefined
  ${If} "$OUTPOST_DATA" == ""
    Abort # that is, don't show this page.
  ${EndIf}
FunctionEnd

Function FindOutpost
  Exch $R0
  Push $R1
  ${IfNot} ${FileExists} "$R0"
   DetailPrint `No $R0`
  ${Else}
    ${If} "$AOCLIENT_EXE" == ""
      ${IfNot} ${FileExists} "$R0\Aoclient.exe"
        DetailPrint `No Aoclient.exe in $R0`
      ${Else}
        DetailPrint `Found Aoclient.exe in $R0`
        StrCpy $AOCLIENT_EXE "$R0\Aoclient.exe"
      ${EndIf}
    ${EndIf}
    ClearErrors
    StrCpy $R1 ""
    ReadINIStr $R1 "$R0\Outpost.conf" DataDirectory DataDir
    ${If} "$R1" == ""
      DetailPrint `No DataDir in $R0\Outpost.conf`
    ${Else}
      DetailPrint `Found Outpost data in $R1`
      StrCpy $OUTPOST_CODE "$OUTPOST_CODE $\"$R0$\""
      StrCpy $OUTPOST_DATA "$OUTPOST_DATA $\"$R1$\""
    ${EndIf}
    ClearErrors
  ${EndIf}
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

# Set $OUTPOST_DATA = a space-separated list of folders that contain Outpost configuration files.
# If no such folders are found, set it to "".
Function FindOutposts
  StrCpy $OUTPOST_CODE ""
  StrCpy $OUTPOST_DATA ""
  Push "$PROGRAMFILES\SCCo Packet"
  Call FindOutpost
  ${If} "$PROGRAMFILES64" != "$PROGRAMFILES"
    Push "$PROGRAMFILES64\SCCo Packet"
    Call FindOutpost
  ${EndIf}
FunctionEnd

Function un.FindOutposts
  Push $R0
  FileOpen $R0 "$INSTDIR\uninstallFrom.txt" r
  FileRead $R0 $OUTPOST_DATA
  FileClose $R0
  Pop $R0
FunctionEnd

!macro defineGlobalFunctions un
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
  ${Delete} UserGuide.*
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
  ${If} "$OUTPOST_DATA" == ""
    Call FindOutposts # DetailPrint diagnostic information
    MessageBox MB_OK|MB_ICONSTOP "Before you install ${DisplayName}, please install SCCo Packet. No recent version is installed, it appears."
    Abort "Outpost PMM data not found."
  ${EndIf}

  # Where to install files:
  CreateDirectory "$INSTDIR"
  SetOutPath "$INSTDIR"

  ${If} ${FileExists} "${PROGRAM_PATH}"
    # Stop the server (so it will release its lock on ${PROGRAM_PATH}):
    ExecShellWait open "${PROGRAM_PATH}" "stop" SW_SHOWMINIMIZED
  ${EndIf}
  Call DeleteMyFiles
  FileOpen $R0 "$INSTDIR\uninstallFrom.txt" w
  FileWrite $R0 $OUTPOST_DATA
  FileClose $R0

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
  File UserGuide.html
  SetOutPath "$INSTDIR\addons"
  File addons\${addon_name}.launch
  SetOutPath "$INSTDIR\bin"
  File /r /x "*~" /x server-port.txt /x *.log bin\*
  SetOutPath "$INSTDIR\pack-it-forms"
  File /r /x "*~" /x .git* pack-it-forms\*
  File icon-*.png
  SetOutPath "$INSTDIR"
  Rename "bin\Outpost_Forms.exe" "${PROGRAM_PATH}"

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
  ExecShellWait open "${PROGRAM_PATH}" "install ${PROGRAM_PATH} $WSCRIPT_EXE$OUTPOST_DATA" SW_SHOWMINIMIZED
  ${If} ${Errors}
    Abort "install failed"
  ${EndIf}

  # Execute a dry run, to encourage antivirus/firewall software to accept the new code.
  ClearErrors
  ${If} ${AtMostWinXP}
    ExecShellWait open              ".\launch.cmd" "dry-run ${PROGRAM_PATH}" SW_SHOWMINIMIZED
  ${Else}
    ExecShellWait open "$WSCRIPT_EXE" ".\launch.vbs dry-run ${PROGRAM_PATH}" SW_SHOWMINIMIZED
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
  DetailPrint "${PROGRAM_PATH} uninstall$OUTPOST_DATA"
  ExecShellWait open "${PROGRAM_PATH}" "uninstall$OUTPOST_DATA" SW_SHOWMINIMIZED

  Call un.DeleteMyFiles
  ${Delete} uninstallFrom.txt
  RMDir "$INSTDIR" # Do nothing if the directory is not empty
SectionEnd
