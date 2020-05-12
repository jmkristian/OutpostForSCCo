/* Copyright 2020 by John Kristian

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

const concat_stream = require('concat-stream');
const fs = require('fs');
const http = require('http');
const path = require('path');
const stream = require('stream');

const CHARSET = 'utf-8'; // for HTTP
const ENCODING = CHARSET; // for files
const EOL = '\r\n';
const LOG_FOLDER = 'logs';

const seconds = 1000;
const hours = 60 * 60 * seconds;

function runCommand(verbs) {
    const verb = process.argv[2];
    ((['dry-run', 'install', 'open', 'start', 'stop'].indexOf(verb) >= 0)
     ? fsp.checkFolder(LOG_FOLDER).then(function() {logToFile(verb);})
     : Promise.resolve()
    ).then(function() {
        if (verbs[verb]) {
            return verbs[verb]();
        } else {
            throw 'unknown verb "' + verb + '"';
        }
    }).catch(function(err) {
        log(err);
        process.exitCode = 1;
    });
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

const fsp = { // Like fs, except functions return Promises.

    appendFile: function(name, data, options) {
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

    checkFolder: function(name) {
        return fsp.stat(name).then(
            function(stats) {
                return false; // not created
            },
            function(err) {
                return fsp.createFolder(name);
            });
    },

    copyFile: function(source, target) {
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

    createFolder: function(name) {
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

    readdir: function(name) { // @return Promise<array of String>
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

    readFile: function(name, options) { // @return Promise<String or Buffer>
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

    rename: function(oldPath, newPath) {
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

    stat: function(name) {
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

    unlink: function(name) { // @return Promise<String or Buffer>
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

    writeFile: function(name, data, options) {
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

function httpExchange(options) {
    const exchange = {};
    function onError(event) {
        return function(err) {
            (exchange.callback || log)(err || event);
        }
    }
    const req = http.request(options, function(res) {
        exchange.res = res;
        res.on('aborted', onError('res.aborted'));
        res.on('error', onError('res.error'));
        res.on('timeout', onError('res.timeout'));
        res.pipe(concat_stream(function(buffer) {
            if (exchange.callback) {
                exchange.callback(null, buffer.toString(CHARSET));
            }
        }));
    });
    req.on('aborted', onError('req.aborted'));
    req.on('error', onError('req.error'));
    req.on('timeout', onError('req.timeout'));
    exchange.req = req;
    return exchange;
}

function httpPromise(exchange, reqBody) {
    return new Promise(function(resolve, reject) {
        try {
            exchange.callback = function httpCallback(err, data) {
                exchange.resBody = data;
                if (err) reject(err);
                else resolve(exchange);
            };
            exchange.req.end(reqBody, CHARSET);
        } catch(err) {
            reject(err);
        }
    });
}

function log(data) {
    if (data) {
        var message = (typeof data == 'object') ? errorToMessage(data) : ('' + data);
        console.log('[' + new Date().toISOString() + '] ' + message);
    }
}

function logToFile(fileNameSuffix) {
    const windowsEOL = new stream.Transform({
        // Transform line endings from Unix style to Windows style.
        transform: function(chunk, encoding, output) {
            if (encoding == 'buffer') {
                output(null, new Buffer(chunk.toString('binary')
                                        .replace(/([^\r])\n/g, '$1' + EOL),
                                        'binary'));;
            } else if (typeof chunk == 'string') {
                output(null, chunk.replace(/([^\r])\n/g, '$1' + EOL));
            } else {
                output(null, chunk); // no change to an object
            }
        }
    });
    var fileStream = null;
    var fileName = null;
    var nextDay = 0;
    const dailyFile = new stream.Writable(
        {decodeStrings: false, objectMode: true,
         write: function(chunk, encoding, next) {
             var today = new Date();
             if (+today >= nextDay) {
                 today.setUTCHours(0);
                 today.setUTCMinutes(0);
                 today.setUTCSeconds(0);
                 today.setUTCMilliseconds(0);
                 const prefix = today.toISOString().substring(0, 10) + '-';
                 const nextFileName = path.join(LOG_FOLDER, prefix + fileNameSuffix +'.log');
                 if (nextFileName == fileName) {
                     // Oops, we jumped the gun. Wait a second longer:
                     nextDay = +today + seconds;
                 } else {
                     nextDay = +today + (24 * hours);
                     const nextFileStream = fs.createWriteStream(nextFileName, {flags: 'a', autoClose: true});
                     if (fileStream) {
                         fileStream.end();
                     }
                     fileStream = nextFileStream;
                     fileName = nextFileName;
                     exports.logFileName = path.resolve(fileName);
                     deleteOldFiles(LOG_FOLDER, /\.log$/, 7 * 24 * hours);
                 }
             }
             return fileStream.write(chunk, encoding, next);
         }});
    windowsEOL.pipe(dailyFile);
    const writer = windowsEOL.write.bind(windowsEOL);
    process.stdout.write = process.stderr.write = writer;
}

function deleteOldFiles(directoryName, fileNamePattern, ageLimitMs) {
    return fsp.stat(
        directoryName
    ).then(function(stats) {
        fsp.readdir(directoryName).then(function(fileNames) {
            const deadline = (new Date).getTime() - ageLimitMs;
            return Promise.all(
                fileNames.filter(function(fileName) {
                    return fileNamePattern.test(fileName);
                }).map(function(fileName) {
                    const fullName = path.join(directoryName, fileName);
                    return fsp.stat(fullName).then(function(stats) {
                        if (stats.isFile()) {
                            const fileTime = stats.mtime.getTime();
                            if (fileTime < deadline) {
                                fsp.unlink(fullName).then(function() {
                                    log("Deleted " + fullName);
                                }, log);
                            }
                        }
                    });
                })
            );
        }).catch(log);
    }, function noSuchDirectory(err) {})
}

function enquoteRegex(text) {
    // Crude but adequate:
    return ('' + text).replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

exports = module.exports = {
    CHARSET: CHARSET,
    ENCODING: ENCODING,
    EOL: EOL,
    LOCALHOST: '127.0.0.1',
    LOG_FOLDER: LOG_FOLDER,
    OpenOutpostMessage: '/openOutpostMessage',
    PortFileName: path.join(LOG_FOLDER, 'server-port.txt'),
    StopServer: '/stopSCCoPIFO',

    HTTP_OK: 200,
    JSON_TYPE: 'application/json',
    SEE_OTHER: 303,

    deleteOldFiles: deleteOldFiles,
    enquoteRegex: enquoteRegex,
    errorToMessage: errorToMessage,
    expandVariables: expandVariables,
    expandVariablesInFile: expandVariablesInFile,
    fsp: fsp,
    httpExchange: httpExchange,
    httpPromise: httpPromise,
    log: log,
    logFileName: null,
    logToFile: logToFile,
    runCommand: runCommand
};
