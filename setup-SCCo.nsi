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

!define INSTDIR_NAME "PackItForms\Outpost\SCCo"
!define REG_SUBKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\SCCoPackItForms"
!define WINDOW_TITLE "Santa Clara County"

!include LogicLib.nsh

Function ChooseAddonFiles
  File /r /x "*~" /x .git* /x notes /x pacread /x integration.js \
    /x form-*.html /x pdf /x http-request.html \
    pack-it-forms
  SetOutPath "$INSTDIR\pack-it-forms"
  ${If} "${OutFileSuffix}" == pvt
    File /x form-los-altos* pack-it-forms\form-*.html
  ${Else}
    File pack-it-forms\form-ics213*.html
    File pack-it-forms\form-oa-muni-status*.html
    File pack-it-forms\form-oa-shelter-status*.html
    File pack-it-forms\form-scco-eoc-213rr*.html
    File pack-it-forms\form-allied-health-facility-status*.html
  ${EndIf}
  SetOutPath "$INSTDIR\pack-it-forms\pdf"
  ${If} "${OutFileSuffix}" == pvt
    File pack-it-forms\pdf\*.pdf
  ${Else}
    File pack-it-forms\pdf\ICS-213_*.pdf
    File pack-it-forms\pdf\XSC_EOC-213RR_*.pdf
    File pack-it-forms\pdf\XSC_MuniStat_*.pdf
    File pack-it-forms\pdf\XSC_SheltStat_*.pdf
    File pack-it-forms\pdf\Allied_Health_Facility_Status_*.pdf
  ${EndIf}
  SetOutPath "$INSTDIR\addons"
  File /oname=${addon_name}.launch "addons\${LaunchFile}"
FunctionEnd

OutFile "SCCoPIFOsetup${VersionMajor}.${VersionMinor}${OutFileSuffix}.exe"
!include setup.nsi
