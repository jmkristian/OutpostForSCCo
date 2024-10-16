/* Copyright 2024 by John Kristian

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

// Expand templates in HTML files.

const fromFolder = process.argv[2];
const intoFolder = process.argv[3] || 'built/pack-it-forms';

const fs = require('fs');
const fsp = require('./bin/fsp.js');
const mustache = require('mustache');
const path = require('path');
const utilities = require('./bin/utilities.js');
const VM = require('vm');

const compiledScripts = {};
const log = utilities.log;
const ENCODING = 'utf-8'; // for files

mustache.tags = ['<%', '%>'];

function findIncludeFile(name) {
    var fullName = path.join(fromFolder, name);
    try {
        if (!fs.statSync(fullName)) throw 'nonexistent';
    } catch(err) {
        fullName = path.join('pack-it-forms', name);
    }
    return fullName;
}

function toScript(code) {
    try {
        var script = compiledScripts[code];
        if (script != undefined) return script;
        script = new VM.Script(code);
        compiledScripts[code] = script;
        return script;
    } catch(err) {
        throw {message:`toScript(${code}) failed`, cause: err};
    }
}

function expand(template, templateFileName) {
    var sandbox;
    var requiredPromises;
    // The templating engine is Mustache, extended with a fancy context:
    const globalContext = { // These tags are available to the template and any included templates.
        nextFieldNumber: function getNextFieldNumber() { // function tag
            if (sandbox.nextFieldNumber >= 0) {
                return `<span class="field-number">${sandbox.nextFieldNumber++}</span>`;
            } else {
                return '';
            }
        },
        nextTabIndex: function getNextTabIndex() { // function tag
            return `${sandbox.nextTabIndex++}`;
        },
        sameTabIndex: function getSameTabIndex() { // function tag
            return `${sandbox.nextTabIndex - 1}`;
        },
        include: function() { // section tag
            return function include(blockText, render) {
                const fileName = render(blockText).trim();
                const result = sandbox.include(fileName);
                if (result instanceof Promise) {
                    requiredPromises.push(result);
                    return 'TBD';
                }
                return (result == undefined) ? '' : `${result}`;
            };
        },
        run: function() { // section tag
            return function run(blockText, render) {
                //log(`run(${blockText})`);
                const code = render(blockText); // Expand any mustache tags within blockText.
                const result = toScript(code).runInContext(sandbox);
                if (result instanceof Promise) {
                    requiredPromises.push(result);
                    return 'TBD';
                }
                return (result == undefined) ? '' : `${result}`;
            };
        },
    };
    var includedFiles = {};
    const include = function include(name, context) {
        const fileName = findIncludeFile(name);
        const nestedTemplate = includedFiles[fileName];
        if ((typeof nestedTemplate) == 'string') {
            try {
                // The nestedContext inherits the globalContext:
                const nestedContext = Object.assign({}, globalContext, context || {});
                const result = mustache.render(nestedTemplate, nestedContext);
                //log(`mustache.render(${nestedTemplate}, ${JSON.stringify(nestedContext)}) == ${result}`);
                return result;
            } catch(err) {
                throw {message: `include(${fileName}, ${JSON.stringify(context)}) failed`, cause: err};
            }
        }
        // We need to read the nestedTemplate from a file.
        if (includedFiles[fileName] == undefined) {
            includedFiles[fileName] = false; // We'll read it soon.
            log(`${templateFileName} includes ${fileName}`);
            //log(`requiredPromises.push(readFile(${fileName}))`);
            return fsp.readFile(
                fileName, ENCODING
            ).then(function(template) {
                //log(`includedFiles[${fileName}] = ${template}`);
                includedFiles[fileName] = template;
            });
        }
        return "TBD";
    };
    /* The form template may require including more files. If so, we
       make at least two attempts to render the template. The first attempt
       discovers what files are required. All the files are fetched into
       includedFiles, and then we repeat the attempt. This continues until
       all the data have been fetched. The last attempt completes rendering.
    */
    var expanded;
    const attempt = function attempt() {
        requiredPromises = []; // a new array object
        sandbox = VM.createContext({
            include: include,
            nextFieldNumber: -1,
            nextTabIndex: 1,
        });
        try {
            const result = mustache.render(expanded, globalContext);
            if (requiredPromises.length > 0) {
                return Promise.all(requiredPromises).then(attempt); // try again
            } else {
                return Promise.resolve(result);
            }
        } catch(err) {
            throw {message: `render(${templateFileName}) failed`, cause: err};
        }
    };
    expanded = template;
    return attempt();
}

fsp.checkFolder(
    intoFolder
).then(function() {
    return Promise.all(
        fs.readdirSync(fromFolder)
            .filter(function(name) {
                return name.endsWith('.html');
            })
            .map(function(fileName) {
                return fsp.readFile(
                    path.join(fromFolder, fileName), ENCODING
                ).then(function(template) {
                    return expand(template, fileName);
                }).then(function(html) {
                    return fsp.writeFile(
                        path.join(intoFolder, fileName),
                        html,
                        {encoding: ENCODING}
                    );
                });
            })
    );
}).catch(function(err) {
    log(err);
    process.exitCode = 1;
});
