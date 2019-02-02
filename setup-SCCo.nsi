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

# This is meant to be interpreted by the Nullsoft scriptable install system http://nsis.sourceforge.net

!define addon_name Enhanced
!define DisplayName "SCCo Pack-It-Forms for Outpost (Public Edition)"
!define INSTDIR_NAME "PackItForms\Outpost\SCCo"
!define REG_SUBKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\SCCoPackItForms"
!define PROGRAM_PATH "bin\SCCoPIFO.exe"
!define WINDOW_TITLE "Santa Clara County"

Function ChooseAddonFiles
  File /r /x "*~" /x .git* /x form-los-altos*.html /x http-request.html pack-it-forms
  SetOutPath "$INSTDIR\addons"
  File /oname=${addon_name}.launch addons\SCCo.launch
FunctionEnd

!include setup-version.nsi
OutFile "SCCoPIFOsetup${VersionMajor}.${VersionMinor}pub.exe"
!include setup.nsi
