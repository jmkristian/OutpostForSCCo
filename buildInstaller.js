/* Copyright 2021 by John Kristian

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

// Prepare files to be incorporated into an installer.

const addonVersion = process.argv[2];
const addonName = process.argv[3];
const programPath = process.argv[4];
const displayName = process.argv[5];

const child_process = require('child_process');
const path = require('path');
const utilities = require('./bin/utilities.js');
const expandVariablesInFile = utilities.expandVariablesInFile;
const log = utilities.log;

Promise.all(
    [
        signVersion(path.join('built', 'Outpost_Forms.exe'), "HTTP server"),
        signVersion(path.join('built', 'WebToPDF.exe'), "Convert web page to PDF"),
        expandVariablesInFile({PROGRAM_PATH: programPath.replace(/\\/g, "\\\\"), DisplayName: displayName},
                              path.join('bin', 'launch.js'),
                              path.join('built', 'bin', 'launch.js')),
        expandVariablesInFile({addon_version: addonVersion, addon_name: addonName, PROGRAM_PATH: programPath},
                              path.join('bin', 'addon.ini'),
                              path.join('built', 'addons', addonName + '.ini')),
        expandVariablesInFile({addon_version: addonVersion, addon_name: addonName, PROGRAM_PATH: programPath},
                              path.join('bin', 'cmd-convert.ini'),
                              path.join('built', 'cmd-convert.ini')),
        expandVariablesInFile({addon_version: addonVersion, addon_name: addonName},
                              path.join('bin', 'manual.html'),
                              path.join('built', 'manual.html'))
    ].concat(
        ['browse.cmd', 'launch-v.cmd', 'UserGuide.html'].map(function(fileName) {
            return expandVariablesInFile({PROGRAM_PATH: programPath, DisplayName: displayName},
                                         fileName, path.join('built', fileName));
        })
    )
).catch(function(err) {
    log(err);
    process.exitCode = 1;
});

function signVersion(codeFile, description) {
    // Set version resources and sign the given codeFile.
    return promiseExecFile(
        path.join('webToPDF', 'setVersion.exe'),
        [codeFile, addonVersion, displayName, description]
    ).then(
        log
    ).then(function() {
        return promiseExecFile(path.join('.', 'sign.cmd'), [codeFile]);
    }).then(log);
}

function promiseExecFile(program, args) {
    return new Promise(function execFile(resolve, reject) {
        try {
            child_process.execFile(
                program, args,
                function(err, stdout, stderr) {
                    try {
                        if (err) reject(err);
                        else resolve(stdout.toString('utf-8') + stderr.toString('utf-8'));
                    } catch(err) {
                        reject(err);
                    }
                });
        } catch(err) {
            reject(err);
        }
    });
}
