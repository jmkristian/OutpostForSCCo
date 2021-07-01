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
const fsp = require('./fsp.js');
const path = require('path');
const ENCODING = 'utf-8'; // for files

function enquoteRegex(text) {
    // Crude but adequate:
    return ('' + text).replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

function errorToMessage(err) {
    if (err == null) {
        return null;
    } else if (err instanceof Error && err.stack) {
        return err.stack;
    } else if (typeof err == 'string') {
        return err;
    } else {
        return JSON.stringify(err);
    }
}

function expandVariables(data, values) {
    for (var v in values) {
        data = data.replace(new RegExp(enquoteRegex('{{' + v + '}}'), 'g'), values[v]);
    }
    return data;
}

function expandVariablesInFile(variables, fromFile, intoFile) {
    if (!intoFile) intoFile = fromFile;
    return fsp.checkFolder(
        path.dirname(intoFile)
    ).then(function() {
        return fsp.readFile(fromFile, ENCODING);
    }).then(function(data) {
        var newData = expandVariables(data, variables);
        if (newData != data || intoFile != fromFile) {
            return fsp.writeFile(
                intoFile, newData, {encoding: ENCODING}
            ).then(function() {
                log(JSON.stringify(variables) + ' in ' + intoFile);
            });
        }
    });
}

function log(data) {
    if (data) {
        console.log(toLogMessage(data));
    }
}

function toLogMessage(data) {
    const message = (typeof data == 'object') ? errorToMessage(data) : ('' + data);
    return '[' + new Date().toISOString() + '] ' + message;
}

exports.errorToMessage = errorToMessage;
exports.enquoteRegex = enquoteRegex;
exports.expandVariables = expandVariables;
exports.expandVariablesInFile = expandVariablesInFile;
exports.log = log;
exports.toLogMessage = toLogMessage;
