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

Name "Santa Clara County" "web forms"

!define addon_name SCCo
!define DisplayName "SCCo Web Forms"
!define INSTDIR_NAME SCCoWebForms
!define SetupFileName SCCoWebForms
!define REG_SUBKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\SCCoWebForms"

!include setup.nsi
