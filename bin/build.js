/* Copyright 2018, 2019 by John Kristian

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

   http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
*/
const path = require('path');

const etc = require('./etc')
const expandVariablesInFile = etc.expandVariablesInFile;

etc.runCommand({'build': build});

function build() {
    const addonVersion = process.argv[3];
    const addonName = process.argv[4];
    const programPath = process.argv[5];
    const displayName = process.argv[6];
    return Promise.all([
        expandVariablesInFile({addon_version: addonVersion, addon_name: addonName, PROGRAM_PATH: programPath},
                              path.join('bin', 'addon.ini'),
                              path.join('built', 'addons', addonName + '.ini')),
        expandVariablesInFile({addon_version: addonVersion, addon_name: addonName, PROGRAM_PATH: programPath},
                              path.join('bin', 'cmd-convert.ini'),
                              path.join('built', 'cmd-convert.ini')),
        expandVariablesInFile({addon_name: addonName},
                              path.join('bin', 'Aoclient.ini'),
                              path.join('built', 'addons', addonName, 'Aoclient.ini')),
        expandVariablesInFile({addon_name: addonName, DisplayName: displayName},
                              path.join('bin', 'manual.html'),
                              path.join('built', 'manual.html'))
    ].concat(
        ['browse.cmd', 'launch-v.cmd', 'launch.vbs', 'pi-browse.sh', 'UserGuide.html'
        ].map(function(fileName) {
            return expandVariablesInFile({PROGRAM_PATH: programPath, DisplayName: displayName},
                                         fileName, path.join('built', fileName));
        })
    ));
}
