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

!define SetupFileName OutpostForLAARES
!define DisplayName "Outpost for LAARES"
!define INSTDIR_NAME OutpostForLAARES
!define addon_name Los_Altos
!define REG_SUBKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\OutpostForLAARES"

!include setup.nsi
