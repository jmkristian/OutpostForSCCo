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

# limitations under the License.

# This is meant to be interpreted by the Nullsoft scriptable install system http://nsis.sourceforge.net

!define addon_name SCCo
!define DisplayName "${addon_name} Web Forms"
!define SetupFileName "${addon_name}WebForms"
!define INSTDIR_NAME "${SetupFileName}"
!define REG_SUBKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${INSTDIR_NAME}"
!define PROGRAM_PATH "bin\${addon_name}_Web_Forms.exe"
!define WINDOW_TITLE "Santa Clara County"

!include setup.nsi