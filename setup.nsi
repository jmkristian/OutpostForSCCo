# Copyright 2018,2019 by John Kristian
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

!define InstalledKey SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall

!include LogicLib.nsh
!include built\addon.nsi

Name "${WINDOW_TITLE}" "forms"

RequestExecutionLevel highest
Page custom selectOutpostCode "" "${WINDOW_TITLE} Setup"
Page directory ifOutpostDataDefined
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

!include nsDialogs.nsh
!include FileFunc.nsh
!include TextFunc.nsh
!include WinVer.nsh

Var /GLOBAL DETAIL_LOG_FILE
Var /GLOBAL OUTPOST_CODE
Var /GLOBAL OUTPOST_DATA
Var /GLOBAL AOCLIENT_EXE
Var /GLOBAL WSCRIPT_EXE

Function .onInit
  StrCpy $DETAIL_LOG_FILE ""
  StrCpy $OUTPOST_DATA ""
  ${If} "$INSTDIR" == ""
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
  nsDialogs::SelectFolderDialog "Where is SCCo Packet installed? Select a folder that contains Outpost.exe and Outpost.conf." "$PROGRAMFILES"
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

!macro DetailLog message
  DetailPrint `${message}`
  ${If} "$DETAIL_LOG_FILE" != ""
    FileWrite $DETAIL_LOG_FILE `${message}$\r$\n`
  ${EndIf}
!macroend
!define DetailLog '!insertmacro "DetailLog"'

!macro AbortLog message
  ${If} "$DETAIL_LOG_FILE" != ""
    FileWrite $DETAIL_LOG_FILE `Abort: ${message}$\r$\n`
  ${EndIf}
  Abort `${message}`
!macroend
!define AbortLog '!insertmacro "AbortLog"'

!macro OpenDetailLogFile fileName
  ${GetTime} "" "LS" $0 $1 $2 $3 $4 $5 $6
  StrCpy $7 "$INSTDIR\logs\$2-$1-$0-${fileName}"
  ${If} ${FileExists} "$7"
    FileOpen $DETAIL_LOG_FILE "$7" a
    ${If} "$DETAIL_LOG_FILE" != ""
      FileSeek $DETAIL_LOG_FILE 0 END
    ${EndIf}
  ${Else}
    CreateDirectory "$INSTDIR\logs"
    ${If} ${Errors}
      DetailPrint `Can't create $INSTDIR\logs`
    ${Else}
      FileOpen $DETAIL_LOG_FILE "$7" w
    ${EndIf}
  ${EndIf}
  ${DetailLog} `[$2-$1-$0T$4:$5:$6] version ${VersionMajor}.${VersionMinor}`
  ClearErrors
!macroend
!define OpenDetailLogFile '!insertmacro "OpenDetailLogFile"'

Function FindOutpost
  Exch $R0
  Push $R1
  ${IfNot} ${FileExists} "$R0"
    ${DetailLog} `No $R0`
  ${Else}
    ${IfNot} ${FileExists} "$R0\Outpost.conf"
      ${DetailLog} `No $R0\Outpost.conf`
    ${Else}
      StrCpy $R1 ""
      ReadINIStr $R1 "$R0\Outpost.conf" DataDirectory DataDir
      ${If} "$R1" == ""
        ${DetailLog} `No DataDir in $R0\Outpost.conf`
      ${Else}
        StrCpy $OUTPOST_CODE "$OUTPOST_CODE $\"$R0$\""
        ${IfNot} ${FileExists} "$R1"
          ${DetailLog} `No $R1`
        ${Else}
          ${DetailLog} `Found Outpost data $R1`
          StrCpy $OUTPOST_DATA '$OUTPOST_DATA "$R1"'
        ${EndIf}
      ${EndIf}
    ${EndIf}
    ClearErrors
    ${If} "$AOCLIENT_EXE" == ""
      ${If} ${FileExists} "$R0\Aoclient.exe"
        StrCpy $AOCLIENT_EXE "$R0\Aoclient.exe"
      ${EndIf}
    ${EndIf}
  ${EndIf}
  Pop $R1
  Pop $R0
FunctionEnd

!macro Execute COMMAND
  Push $R0
  ${DetailLog} `Execute: ${COMMAND}`
  nsExec::ExecToLog '${COMMAND}'
  Pop $R0
  ${If} "$R0" != 0
    SetErrors
    ${DetailLog} `nsExec::ExecToLog returned $R0`
  ${EndIf}
  Pop $R0
!macroend
!define Execute '!insertmacro "Execute"'

!macro Delete NAME
  ${If} ${FileExists} "${NAME}"
    Delete "${NAME}"
    ${If} ${FileExists} "${NAME}"
      ${DetailLog} `Can't delete ${NAME}`
      SetErrors
    ${Endif}
  ${Endif}
!macroend
!define Delete '!insertmacro "Delete"'

!macro RMDir NAME
  ${If} ${FileExists} "${NAME}"
    RMDir /r "${NAME}"
    ${If} ${FileExists} "${NAME}"
      ${DetailLog} `Can't remove ${NAME}`
      SetErrors
    ${EndIf}
  ${EndIf}
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
  ${If} "$OUTPOST_DATA" == ""
    # Try to find SCCo Packet in the registry:
    Push $R0
    Push $R1
    Push $R2
    Push $R3
    SetRegView 64
    StrCpy $R0 0
    nextInstalledProgram:
      EnumRegKey $R1 HKLM "${InstalledKey}" $R0
      StrCmp "$R1" "" endInstalledPrograms
      ReadRegStr $R2 HKLM "${InstalledKey}\$R1" "Inno setup: Icon Group"
      ${If} "$R2" == "SCCo Packet"
        ReadRegStr $R2 HKLM "${InstalledKey}\$R1" "InstallLocation"
        ${If} "$R2" == ""
          ${DetailLog} `No InstallLocation in $R1`
        ${Else}
          StrCpy $R3 $R2 1 -1
          ${If} "$R3" == "\"
            StrCpy $R2 $R2 -1
          ${EndIf}
          ${DetailLog} `InstallLocation: $R2 in $R1`
          Push "$R2"
          Call FindOutpost
        ${EndIf}
      ${EndIf}
      IntOp $R0 $R0 + 1
      GoTo nextInstalledProgram
    endInstalledPrograms:
    Pop $R3
    Pop $R2
    Pop $R1
    Pop $R0
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

Function ${un}SetShellVarContextAppropriately
  Call ${un}IsUserAdmin
  Pop $1
  ${If} $1 == true
    SetShellVarContext all
  ${Else}
    SetShellVarContext current
  ${EndIf}
FunctionEnd

Function ${un}DeleteMyFiles
  Push $R0
  Push $R1
  # It doesn't really matter whether these are deleted:
  ${RMDir} "$INSTDIR\bin\Chromium-*" # Allow some time for ${PROGRAM_PATH} to exit.
  ${Delete} README.*
  ${Delete} UserGuide.*
  ${Delete} launch.vbs
  ${Delete} launch.cmd
  ${Delete} launch-v.cmd
  ${Delete} version.txt
  ${RMDir} "$INSTDIR\bin"
  ${RMDir} "$INSTDIR\converted"
  ${RMDir} "$INSTDIR\notes"
  ${RMDir} "$INSTDIR\pdf"
  ClearErrors
  ${Delete} browse.cmd
  ${Delete} bin\launch.vbs
  ${Delete} bin\launch.cmd
  ${Delete} bin\launch-v.cmd
  ${Delete} "${PROGRAM_PATH}"
  ${RMDir} "$INSTDIR\addons"
  ${RMDir} "$INSTDIR\pack-it-forms"
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
  ${OpenDetailLogFile} setup.log

  # Stop the server (so it will release its lock on the program and log file):
  ${If} ${FileExists} "${PROGRAM_PATH}"
    ${Execute} '"${PROGRAM_PATH}" stop'
  ${ElseIf} ${FileExists} "bin\SCCoPIFO.exe"
    ${Execute} "bin\SCCoPIFO.exe stop"
  ${ElseIf} ${FileExists} "bin\Outpost_Forms.exe"
    ${Execute} "bin\Outpost_Forms.exe stop"
  ${Else}
    ${DetailLog} `No ${PROGRAM_PATH}`
  ${EndIf}

  ${If} ${Silent}
    Call FindOutposts
  ${EndIf}
  ${If} "$OUTPOST_DATA" == ""
    StrCpy $R0 "I won't add forms to Outpost"
    StrCpy $R0 "$R0, because I didn't find Outpost's data folder."
    StrCpy $R0 "$R0  Do you want to continue installing ${DisplayName}?"
    MessageBox MB_OKCANCEL|MB_DEFBUTTON2|MB_ICONEXCLAMATION "$R0" /SD IDOK IDOK noFormsOK
    Call FindOutposts # DetailPrint diagnostic information
    ${AbortLog} `No Outpost data folder`
    noFormsOK:
  ${Else}
    ${DetailLog} `Outpost data$OUTPOST_DATA`
  ${EndIf}
  ${DetailLog} `Outpost code$OUTPOST_CODE`

  Call DeleteMyFiles
  ${If} ${Errors}
    # Sadly, it may take time for ${PROGRAM_PATH} to be deleted.
    # There are several possible causes, including zealous antivirus.
    StrCpy $R0 "Some files were not deleted from $INSTDIR. Try again?"
    MessageBox MB_YESNO|MB_DEFBUTTON1|MB_ICONINFORMATION "$R0" /SD IDYES IDNO noDeleteAgain
    StrCpy $R0 0
    ${DoUntil} $R0 = 12
      ${DetailLog} `Wait $R0 seconds`
      IntOp $R1 $R0 * 1000
      Sleep $R1
      IntOp $R0 $R0 + 1
      Call DeleteMyFiles
    ${LoopWhile} ${Errors}
    ${If} ${Errors}
      noDeleteAgain:
      ${AbortLog} `Can't delete old files`
    ${EndIf}
  ${EndIf}
  ${Delete} uninstall.exe
  FileOpen $R0 "uninstallFrom.txt" w
  FileWrite $R0 "$OUTPOST_DATA"
  FileClose $R0
  FileOpen $R0 "version.txt" w
  FileWrite $R0 "${VersionMajor}.${VersionMinor}"
  FileClose $R0

  CreateDirectory "$INSTDIR\addons\${addon_name}"
  StrCpy $R0 "You might not be able to submit messages to Outpost"
  ${If} "$OUTPOST_CODE" == ""
    StrCpy $R0 "$R0, because I don't know where it's installed."
    Call FindOutposts # DetailPrint diagnostic information
  ${ElseIf} "$AOCLIENT_EXE" == ""
    StrCpy $R0 "$R0, because I can't find Aoclient.exe in $OUTPOST_CODE."
  ${Else}
    ${DetailLog} `Copy from $AOCLIENT_EXE`
    ClearErrors
    CopyFiles "$AOCLIENT_EXE" "$INSTDIR\addons\${addon_name}\Aoclient.exe"
    ${If} ${Errors}
      StrCpy $R0 "$R0, because I can't copy $AOCLIENT_EXE."
      Call IsUserAdmin
      Pop $1
      ${If} $1 != true
        StrCpy $R0 "$R0 To copy it, try running this installer as an administrator."
      ${EndIf}
    ${Else}
      GoTo AoclientOK
    ${EndIf}
  ${EndIf}
  StrCpy $R0 "$R0  Do you want to continue installing ${DisplayName}?"
  MessageBox MB_OKCANCEL|MB_DEFBUTTON2|MB_ICONEXCLAMATION "$R0" /SD IDOK IDOK AoclientOK
  ${AbortLog} `Can't copy Aoclient.exe`
  AoclientOK:

  # Files to install:
  SetOutPath "$INSTDIR\bin"
  File built\launch.vbs
  File built\launch-v.cmd
  File built\manual.html
  File bin\message.html
  File bin\server.ini
  File bin\subject.cmd
  ${IfNot} ${IsWinXP}
     File /r webToPDF\Chromium-81.0.4044.92
     File webToPDF\WebToPDF.exe
     File webToPDF\WebToPDF.js
     File built\cmd-convert.ini
  ${EndIf}
  SetOutPath "$INSTDIR"
  File built\browse.cmd
  File built\UserGuide.html
  File /r built\addons
  File "/oname=${PROGRAM_PATH}" built\Outpost_Forms.exe
  Call ChooseAddonFiles
  SetOutPath "$INSTDIR\pack-it-forms"
  File icon-*.png
  File /oname=resources\integration\integration.js pack-it-forms\resources\integration\scco\integration.js
  SetOutPath "$INSTDIR"

  # define uninstaller:
  WriteUninstaller "$INSTDIR\uninstall.exe"
  ClearErrors
  SetRegView 32
  WriteRegStr   HKLM "${REG_SUBKEY}" DisplayName "${DisplayName} v${VersionMajor}.${VersionMinor}"
  WriteRegStr   HKLM "${REG_SUBKEY}" UninstallString "$\"$INSTDIR\uninstall.exe$\""
  ${If} ${Errors}
    ${DetailLog} `not registered`
    StrCpy $0 "${DisplayName} wasn't registered with Windows as a program."
    StrCpy $0 "$0 You can still use it, but to uninstall it you'll have to run uninstall.exe in $INSTDIR."
    Call IsUserAdmin
    Pop $1
    ${If} $1 != true
      StrCpy $0 "$0 To register it, run this installer again as an administrator."
    ${EndIf}
    MessageBox MB_OK|MB_ICONINFORMATION "$0" /SD IDOK
  ${EndIf}
  WriteRegStr   HKLM "${REG_SUBKEY}" Publisher "Los Altos ARES"
  WriteRegStr   HKLM "${REG_SUBKEY}" URLInfoAbout "$INSTDIR\UserGuide.html"
  WriteRegStr   HKLM "${REG_SUBKEY}" DisplayVersion "${VersionMajor}.${VersionMinor}"
  WriteRegDWORD HKLM "${REG_SUBKEY}" VersionMajor ${VersionMajor}
  WriteRegDWORD HKLM "${REG_SUBKEY}" VersionMinor ${VersionMinor}
  WriteRegDWORD HKLM "${REG_SUBKEY}" NoModify 1
  WriteRegDWORD HKLM "${REG_SUBKEY}" NoRepair 1
  WriteRegDWORD HKLM "${REG_SUBKEY}" EstimatedSize 245000

  # Add the uninstaller to the Start menu:
  Call SetShellVarContextAppropriately
  ${If} ${FileExists} "$SMPROGRAMS\SCCo Packet"
    CreateShortcut "$SMPROGRAMS\SCCo Packet\Uninstall ${DisplayName}.lnk" "$INSTDIR\uninstall.exe"
  ${EndIf}

  StrCpy $WSCRIPT_EXE "$SYSDIR\wscript.exe"
  ${IfNot} ${FileExists} "$WSCRIPT_EXE"
    StrCpy $WSCRIPT_EXE "$WINDIR\System\wscript.exe"
  ${EndIf}
  SimpleFC::addApplication "${DisplayName}" "${PROGRAM_PATH}" 1 2 "" 1
  ClearErrors
  ${Execute} '"${PROGRAM_PATH}" install "$WSCRIPT_EXE" $OUTPOST_DATA'
  ${If} ${Errors}
    ${AbortLog} `"${PROGRAM_PATH}" install failed`
  ${EndIf}

  # Execute a dry run, to encourage antivirus/firewall software to accept the new code.
  ClearErrors
  ${Execute} '"$WSCRIPT_EXE" bin\launch.vbs dry-run "${PROGRAM_PATH}"'
  ${If} ${Errors}
    ${AbortLog} `dry-run failed`
  ${EndIf}
  ${If} "$DETAIL_LOG_FILE" != ""
    FileClose "$DETAIL_LOG_FILE"
  ${EndIf}
SectionEnd

Section "Uninstall"
  SetOutPath "$INSTDIR"

  # Be sure to delete the uninstaller first.
  ${Delete} "$INSTDIR\uninstall.exe"
  DeleteRegKey HKLM "${REG_SUBKEY}"

  # Remove our line from Outpost configuration files
  Call un.FindOutposts
  ${Execute} '"${PROGRAM_PATH}" uninstall$OUTPOST_DATA'

  Call un.SetShellVarContextAppropriately
  ${Delete} "$SMPROGRAMS\SCCo Packet\Uninstall ${DisplayName}.lnk"
  Call un.DeleteMyFiles
  ${Delete} silent.log
  ${Delete} uninstallFrom.txt
  ${RMDir} "$INSTDIR\logs"
  ${RMDir} "$INSTDIR\saved"
  ${If} ${Errors}
    StrCpy $R0 "Some files were not deleted from $INSTDIR."
    MessageBox MB_OK|MB_ICONINFORMATION "$R0" /SD IDOK
  ${EndIf}
  RMDir "$INSTDIR" # Do nothing if the directory is not empty
SectionEnd
