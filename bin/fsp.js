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
/*
  This is a module like fs, except functions return Promises.
  A similar module is experimental in node.js version 10.
*/
const fs = require('fs');
const fsp = {

    appendFile: function appendFile(name, data, options) {
        return new Promise(function appendFile(resolve, reject) {
            try {
                fs.appendFile(name, data, options, function(err) {
                    if (err) reject(err);
                    else resolve(true);
                });
            } catch(err) {
                reject(err);
            }
        });
    },

    checkFolder: function checkFolder(name) {
        return fsp.stat(name).then(
            function(stats) {
                return false; // not created
            },
            function(err) {
                return fsp.createFolder(name);
            });
    },

    copyFile: function copyFile(source, target) {
        return new Promise(function copyFile(resolve, reject) {
            var settled = false;
            function settle(err) {
                if (!settled) {
                    settled = true;
                    if (err) reject(err);
                    else resolve();
                }
            }
            try {
                const from = fs.createReadStream(source);
                from.on('error', settle);
                const into = fs.createWriteStream(target);
                into.on('error', settle);
                into.on('close', function() {settle();});
                from.pipe(into);
            } catch(err) {
                settle(err);
            }
        });
    },

    createFolder: function createFolder(name) {
        return new Promise(function createFolder(resolve, reject) {
            try {
                fs.mkdir(name, function(err) {
                    if (err) reject(err);
                    else resolve(true); // created
                });
            } catch(err) {
                reject(err);
            }
        });
    },

    readdir: function readdir(name) { // @return Promise<array of String>
        return new Promise(function readdir(resolve, reject) {
            try {
                fs.readdir(name, function(err, files) {
                    if (err) reject(err);
                    else resolve(files);
                });
            } catch(err) {
                reject(err);
            }
        });
    },

    readFile: function readFile(name, options) { // @return Promise<String or Buffer>
        return new Promise(function readFile(resolve, reject) {
            try {
                fs.readFile(name, options, function(err, data) {
                    if (err) reject(err);
                    else resolve(data);
                });
            } catch(err) {
                reject(err);
            }
        });
    },

    rename: function rename(oldPath, newPath) {
        return new Promise(function rename(resolve, reject) {
            try {
                fs.rename(oldPath, newPath, function(err) {
                    if (err) reject(err);
                    else resolve();
                });
            } catch(err) {
                reject(err);
            }
        });
    },

    stat: function stat(name) {
        return new Promise(function stat(resolve, reject) {
            try {
                fs.stat(name, function(err, stats) {
                    if (err) reject(err);
                    else if (stats) resolve(stats);
                    else reject(`No Stats from ${name}`);
                });
            } catch(err) {
                reject(err);
            }
        });
    },

    unlink: function unlink(name) { // @return Promise<String or Buffer>
        return new Promise(function unlink(resolve, reject) {
            try {
                fs.unlink(name, function(err) {
                    if (err) reject(err);
                    else resolve();
                });
            } catch(err) {
                reject(err);
            }
        });
    },

    writeFile: function writeFile(name, data, options) {
        return new Promise(function writeFile(resolve, reject) {
            try {
                fs.writeFile(name, data, options, function(err) {
                    if (err) reject(err);
                    else resolve(true);
                });
            } catch(err) {
                reject(err);
            }
        });
    }
};

for (var fn in fsp) {
    exports[fn] = fsp[fn];
}
