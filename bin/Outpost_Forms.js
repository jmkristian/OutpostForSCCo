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
  This is a Node.js program which serves several purposes:
  - Edit configuration files during installation
  - Undo those edits during uninstallation
  - Receive a message from Outpost
  - Construct an HTML form representing a message
  - Show the form to an operator
  - Submit a message to Outpost

  Any single execution does just one of those things,
  depending on the value of process.argv[2].

  When an operator clicks an Outpost Forms menu item to create a message
  or opens an existing message that belongs to this add-on,
  a fairly complex sequence of events ensues.
  - Outpost executes this program with arguments specified in addon.ini.
  - This program POSTs the arguments to a server, and then
  - launches a browser, which GETs an HTML form from the server.
  - When the operator clicks "Submit", the browser POSTs a message to the server,
  - and the server POSTs a request to Opdirect, which submits the message to Outpost.

  The server is a process running this program with a single argument "serve".
  The server is started as a side-effect of creating or opening a message.
  When this program tries and fails to POST arguments to the server,
  it tries to start the server, delays a bit and retries the POST.
  The server continues to run as long as any of the forms it serves are open,
  plus a time period (look for idleTime). To implement this, the browser pings
  the server periodically, and the server notices when the pings stop.

  It's kind of weird to implement all of this behavior in a single program.
  Splitting it into several programs would have drawbacks:
  - It would be packaged into several frozen binaries, which would bloat the
    installer, since each binary contains the enire Node.js runtime code.
  - Antivirus and firewall software would have to scrutinize multiple programs,
    which is annoying to the developers who have to persuade Symantec to bless
    them and operators who have to wait for Avast to scan them.

  To address the issue of operators waiting for antivirus scan, the
  installation script runs "Outpost_Forms.exe dry-run", which runs this program
  as though it were handling a message, but doesn't launch a browser.
  So the scan happens during installation, not when opening a message.
*/
const AllHtmlEntities = require('html-entities').AllHtmlEntities;
const bodyParser = require('body-parser');
const child_process = require('child_process');
const concat_stream = require('concat-stream');
const express = require('express');
const fs = require('fs');
const fsp = require('./fsp.js');
const http = require('http');
const makeTemp = require('tmp');
const morgan = require('morgan');
const path = require('path');
const querystring = require('querystring');
const stream = require('stream');
const utf8 = require('utf8');
const utilities = require('./utilities');

const errorToMessage = utilities.errorToMessage;
const enquoteRegex = utilities.enquoteRegex;
const expandVariables = utilities.expandVariables;
const expandVariablesInFile = utilities.expandVariablesInFile;
const log = utilities.log;
const toLogMessage = utilities.toLogMessage;

function promiseSpawn(exe, args, options) {
    return new Promise(function spawnChild(resolve, reject) {
        try {
            const child = child_process.spawn(exe, args, options);
            child.stdout.pipe(process.stdout);
            child.stderr.pipe(process.stderr);
            child.on('error', reject);
            child.on('exit', function(code) {
                if (code) reject(`${exe} exit code ${code}`);
                else resolve(child);
            });
        } catch(err) {
            reject(err);
        }
    });
}

function promiseTempFile(options) {
    return new Promise(function tempFile(resolve, reject) {
        try {
            makeTemp.file(options, function(err, name, fd) {
                if (err) reject(err);
                else resolve({name: name, fd: fd});
            });
        } catch(err) {
            reject(err);
        }
    });
}

function promiseTimeout(msec) {
    return new Promise(function timeout(resolve, reject) {
        try {
            setTimeout(resolve, msec);
        } catch(err) {
            reject(err);
        }
    });
}

const HTTP_OK = 200;
const SEE_OTHER = 303;
const FORBIDDEN = 403;
const NOT_FOUND = 404;

const CHARSET = 'utf-8'; // for HTTP
const TrimAddress = /^[^@]*(@[^.]*)?/;
const ENCODING = CHARSET; // for files
const EOL = '\r\n';
const htmlEntities = new AllHtmlEntities();
const INI = { // patterns that match lines from a .ini file.
    comment: /^\s*;/,
    section: /^\s*\[\s*([^\]]*)\s*\]\s*$/,
    property: /^\s*([\w\.\-\_]+)\s*=(.*)$/,
    readFile: function readFile(fileName) {
        log(`INI.readFile ${fileName}`);
        return fsp.readFile(
            fileName, {encoding: ENCODING}
        ).then(function(data) {
            const result = {};
            var section = null;
            data.split(/[\r\n]+/).forEach(function(line) {
                if (INI.comment.test(line)) {
                    return;
                } else if (INI.section.test(line)) {
                    var match = line.match(INI.section);
                    section = match[1];
                    if (result[section] == null) {
                        result[section] = {};
                    }
                } else if (INI.property.test(line)) {
                    var match = line.match(INI.property);
                    if (section) {
                        result[section][match[1]] = match[2];
                    } else {
                        result[match[1]] = match[2];
                    }
                };
            });
            return result;
        });
    },
};
const JSON_TYPE = 'application/json';
const LOCALHOST = '127.0.0.1';
const LOG_FOLDER = 'logs';
const NameValueArg = /^--([^-]*)-([\S\s]*)/; // The value may contain line breaks.
const seconds = 1000;
const hours = 60 * 60 * seconds;
const OpdFAIL = 'OpdFAIL';
const OpenOutpostMessage = '/openOutpostMessage';
const PackItForms = 'pack-it-forms';
const PackItMsgs = path.join(PackItForms, 'msgs');
const PortFileName = path.join(LOG_FOLDER, 'server-port.txt');
const PROBLEM_HEADER = '<html><head><title>Problem</title></head><body>'
      + EOL + '<h3 id="something-went-wrong"><img src="/icon-warning.png" alt="warning"'
      + ' style="width:24pt;height:24pt;vertical-align:middle;margin-right:1em;">'
      + 'Something went wrong.</h3>';
const SAVE_FOLDER = 'saved';
const SEQUENCE_MARK = '^'; // must be OK in a file name, and come after '.' in lexical order
const SEQUENCE_REGEX = /\^/g; // matches all occurrences of SEQUENCE_MARK
const SETTINGS_FILE = path.join('bin', 'server.ini');
const StopServer = '/stopSCCoPIFO';
const TEXT_HTML = 'text/html; charset=' + CHARSET;
const TEXT_PLAIN = 'text/plain; charset=' + CHARSET;
const WEB_TO_PDF = path.join('bin', 'WebToPDF.exe');

var myServerPort = null;
var logFileName = null;
var settingsUpdatedTime = null;
const DEFAULT_SETTINGS = {
    Opdirect: {
        host: LOCALHOST,
        port: 9334,
        timeout: 30 * seconds,
        method: 'POST',
        path: '/TBD'
    }
};
var settings = DEFAULT_SETTINGS;

if (process.argv.length > 2) {
    // With no arguments, do nothing quietly.
    const verb = process.argv[2];
    if (verb == 'decode') {
        console.log(argvSlice(3).map(decodeArg).map(JSON.stringify).join(" "));
        return;
    }
    ((['convert', 'serve', 'subject', 'uninstall'].indexOf(verb) >= 0)
     ? Promise.resolve()
     : fsp.checkFolder(LOG_FOLDER).then(function() {logToFile(verb);})
    ).then(function() {
        switch(verb) {
        case 'install':
            // Edit various files depending on how this program was installed.
            return install();
        case 'uninstall':
            // Remove this add-on from Outpost's configuration.
            return uninstall();
        case 'convert':
            return convert();
        case 'open':
        case 'dry-run':
            // Make sure a server is running, and then send process.argv[4..] to it.
            return browseMessage();
        case 'serve':
            // Serve HTTP requests until a while after there are no forms open.
            serve();
            break;
        case 'stop':
            // Stop any running servers.
            return stopServers();
        case 'subject':
            // Output the subject of the message in a given file.
            outputSubjects(process.argv);
            break;
        default:
            throw 'unknown verb "' + verb + '"';
        }
    }).catch(function(err) {
        log(err);
        process.exitCode = 1;
    });
}

function install() {
    // This method must be idempotent, in part because Avira antivirus
    // might execute it repeatedly while scrutinizing the .exe for viruses.
    const myDirectory = process.cwd();
    return getAddonNames().then(function(addonNames) {
        log('install addons ' + JSON.stringify(addonNames));
        return Promise.all([
            installCmdConvert().then(function(cmdConvert) {
                return installConfigFiles(myDirectory, addonNames, cmdConvert);
            }),
            installIncludes(myDirectory, addonNames),
            fsp.checkFolder(SAVE_FOLDER),
            fsp.checkFolder(LOG_FOLDER)
        ]);
    });
}

function installCmdConvert() {
    const cmdConvertFile = path.join('bin', 'cmd-convert.ini');
    return fsp.stat(
        cmdConvertFile
    ).then(function(stats) {
        // Dry run WEB_TO_PDF:
        return promiseSpawn(
            WEB_TO_PDF, ['bin'], {stdio: ['ignore', 'pipe', 'pipe']}
        ).then(function() {
            return fsp.readFile(cmdConvertFile, ENCODING)
        }).then(function(data) {
            // Success! Add cmd-convert to the addon.ini files.
            fs.unlink(cmdConvertFile, log);
            return data;
        });
    }, function statFailed(err) {
        // cmdConvertFile doesn't exist.
        // We're running on Windows XP, presumably.
        log(err);
    });
}

function installConfigFiles(myDirectory, addonNames, cmdConvert) {
    const launch = process.argv[3] + ' ' + path.join(myDirectory, 'bin', 'launch.js');
    return Promise.all([
        expandVariablesInFile({INSTDIR: myDirectory, LAUNCH: launch}, 'UserGuide.html')
    ].concat(
        addonNames.map(function(addon_name) {
            const addonIni = path.join('addons', addon_name + '.ini');
            return (
                cmdConvert
                    ? fsp.appendFile(addonIni, cmdConvert, {encoding: ENCODING})
                    : Promise.resolve()
            ).then(function() {
                return expandVariablesInFile({INSTDIR: myDirectory, LAUNCH: launch}, addonIni);
            });
        })
    ));
}

/* Make sure Outpost's Launch.ini or Launch.local files include addons/*.launch. */
function installIncludes(myDirectory, addonNames) {
    function includeInto(outpostFolder) {
        const launchIni = path.resolve(outpostFolder, 'Launch.ini');
        return fsp.readFile(
            launchIni, ENCODING
        ).then(function(data) {
            const oldInclude = new RegExp('^INCLUDE[ \\t]+' + enquoteRegex(myDirectory) + '[\\\\/]', 'i');
            const myIncludes = addonNames.map(function(addonName) {
                return 'INCLUDE ' + path.resolve(myDirectory, 'addons', addonName + '.launch');
            });
            const launchLocal = path.resolve(outpostFolder, 'Launch.local');
            if (data.split(/[\r\n]+/).some(function(line) {
                return oldInclude.test(line);
            })) {
                log('already included into ' + launchIni);
                return removeIncludes(addonNames, launchLocal);
            }
            var oldData = null;
            // Upsert myIncludes into launchLocal:
            return fsp.stat(
                launchLocal
            ).then(function() {
                return fsp.readFile(
                    launchLocal, ENCODING
                ).then(function(data) {
                    oldData = data;
                    var oldLines = oldData.split(/[\r\n]+/);
                    var newLines = [];
                    var included = false;
                    oldLines.forEach(function(oldLine) {
                        if (!oldLine) {
                            // remove this line
                        } else if (!oldInclude.test(oldLine)) {
                            newLines.push(oldLine); // no change
                        } else if (!included) {
                            newLines = newLines.concat(myIncludes); // replace with myIncludes
                            included = true;
                        } // else remove this line
                    });
                    if (!included) {
                        newLines = newLines.concat(myIncludes); // append myIncludes
                    }
                    return newLines;
                });
            }, function statFailed(err) {
                // launchLocal doesn't exist.
                return myIncludes;
            }).then(function(newLines) {
                // Work around a bug: Outpost might ignore the first line of Launch.local.
                const newData = EOL + newLines.join(EOL) + EOL;
                if (newData == oldData) {
                    log('already included into ' + launchLocal);
                    return Promise.resolve(true);
                }
                return fsp.writeFile(
                    launchLocal, newData, {encoding: ENCODING}
                ).then(function() {
                    log(`included into ${launchLocal}`);
                });
            });
        }).catch(log);
    };
    // Each of the arguments names a folder that contains Outpost configuration data.
    return Promise.all(argvSlice(4).map(includeInto));
}

function uninstall() {
    return getAddonNames().then(function(addonNames) {
        log('uninstall addons ' + JSON.stringify(addonNames));
        return Promise.all([
            stopServers()
        ].concat(
            argvSlice(3).map(function(outpostFolder) {
                removeIncludes(addonNames, path.resolve(outpostFolder, 'Launch.local'));
            })
        ));
    });
}

function removeIncludes(addonNames, launchLocal) {
    // Remove INCLUDEs from launchLocal:
    return fsp.readFile(
        launchLocal, ENCODING
    ).then(function(data) {
        var newData = data;
        addonNames.forEach(function(addonName) {
            var myLaunch = enquoteRegex(path.resolve(process.cwd(), 'addons', addonName + '.launch'));
            var myInclude1 = new RegExp('^INCLUDE[ \\t]+' + myLaunch + '[\r\n]*', 'i');
            var myInclude = new RegExp('[\r\n]+INCLUDE[ \\t]+' + myLaunch + '[\r\n]+', 'gi');
            newData = newData.replace(myInclude1, '').replace(myInclude, EOL);
        });
        if (newData != data) {
            return fsp.writeFile(
                launchLocal, newData, {encoding: ENCODING}
            ).then(function() {
                log('removed ' + JSON.stringify(addonNames) + ` from ${launchLocal}`);
            });
        }
    }).catch(log);
}

/** @return a Promise of a list of names, such that for each name
    there exists a <name>.launch file in the given directory.
*/
function getAddonNames(directoryName) {
    return fsp.readdir(
        directoryName || 'addons', {encoding: ENCODING}
    ).then(function(fileNames) {
        var addonNames = [];
        fileNames.forEach(function(fileName) {
            var found = /^(.*)\.launch$/.exec(fileName);
            if (found && found[1]) {
                addonNames.push(found[1]);
            }
        });
        addonNames.sort(function (x, y) {
            return x.toLowerCase().localeCompare(y.toLowerCase());
        });
        return addonNames;
    });
}

function argvSlice(start) {
    var args = [];
    for (var i = start; i < process.argv.length; i++) {
        args.push(process.argv[i]);
    }
    return args;
}

function decodeCommandLine(args) {
    // Most args are "--<name>-<value>".
    // Only the values are decoded.
    for (var i = 0; i < args.length; ++i) {
        var nameValue = args[i].match(NameValueArg);
        if (nameValue) {
            args[i] = '--' + nameValue[1] + '-' + decodeArg(nameValue[2]);
        }
    }
    return args;
}

function decodeArg(value) {
    var wasDecoded = false;
    var bytes = value.replace(/~[0-9a-f][0-9a-f]/ig, function(found) {
        wasDecoded = true;
        return String.fromCharCode(parseInt(found.substring(1), 16));
    });
    try {
        return wasDecoded ? utf8.decode(bytes) : value;
    } catch(err) { // for example the bytes aren't UTF-8
        log(err);
        return value;
    }
}

function convert() {
    process.chdir(process.argv[4]);
    return fsp.checkFolder(LOG_FOLDER).then(function() {
        return teeToFile('convert');
    }).then(convertMessageToFiles);
}

function convertMessageToFiles() {
    var args = decodeCommandLine(argvSlice(5));
    const environment = parseArgs(args);
    var message_status = environment.message_status;
    if (!message_status) {
        if (environment.MSG_STATE) {
            switch(environment.MSG_STATE.toLowerCase()) {
            case 'received':
            case 'retrieved':
            case 'unread':
            case 'read':
                message_status = 'received';
                break;
            case 'sent':
                message_status = 'sent';
                break;
            case 'new':
                message_status = 'new';
                break;
            default:
                message_status = 'draft';
            }
        } else if (environment.MSG_DATETIME_OP_RCVD) {
            message_status = 'received';
        } else {
            message_status = 'sent';
        }
        args.push('--message_status-' + message_status);
    }
    const spoolDir = environment.SPOOL_DIR;
    if (spoolDir == null) throw new Error('no SPOOL_DIR in arguments.');
    var copyNames = environment.COPY_NAMES;
    if (copyNames == null) throw new Error('no COPY_NAMES in arguments.');
    copyNames = copyNames.split('\n');
    return fsp.readFile(
        path.resolve(PackItMsgs, environment.MSG_FILENAME), ENCODING
    ).then(function(message) {
        const parsed = parseMessage(message, environment);
        const subject = environment.subject || subjectFromMessage(parsed);
        const spoolFilePrefix = subject
              .replace(/[<>:"/\\|?*]/g, '~')
              .replace(SEQUENCE_REGEX, '~');
        return openMessage(args).then(function(pageURL) {
            const messageID = environment.MSG_NUMBER || parsed.fields.MsgNo;
            return convertPageToFiles(environment.addon_name, pageURL, messageID, copyNames);
        }).then(function(tempFileNames) {
            return spoolFiles(tempFileNames, spoolDir, spoolFilePrefix);
        });
    });
}

function convertPageToFiles(addon_name, pageURL, messageID, copyNames) {
    if (!pageURL) {
        throw 'page URL = ' + JSON.stringify(pageURL);
    }
    const fileNames = [];
    var args = ['bin', pageURL, messageID || ''];
    return copyNames.reduce(
        function(chain, copyName) {
            return chain.then(function() {
                return promiseTempFile({
                    dir: LOG_FOLDER,
                    prefix: 'T', postfix: '.pdf',
                    keep: true, discardDescriptor: true
                });
            }).then(function(tempFile) {
                fileNames.push(tempFile.name);
                args.push(tempFile.name);
                args.push(copyName || '');
            });
        },
        Promise.resolve()
    ).then(function() {
        log(`${WEB_TO_PDF} "` + args.join('" "') + '"')
        return promiseSpawn(WEB_TO_PDF, args, {stdio: ['ignore', 'pipe', 'pipe']});
    }).then(function() {
        return fileNames;
    }, function webToPdfFailed(err) {
        log(err);
        process.exitCode = 1;
        return fileNames;
    });
}

function spoolFiles(tempFileNames, spoolDir, spoolFilePrefix) {
    // Make sure files in spoolDir are processed in the right order,
    // by giving them names that sort lexically.
    return fsp.readdir(spoolDir).then(function(spoolFileNames) {
        var nextNumber = spoolFileNames.reduce(function(found, spoolFile) {
            const base = spoolFile.substring( // ignore the file type
                0, spoolFile.length - path.extname(spoolFile).length
            ).toLowerCase(); // ignore the file name case
            if (base.startsWith(spoolFilePrefix.toLowerCase())) {
                const seq = base.substring(spoolFilePrefix.length);
                return Math.max(found, decodeSeq(seq) + 1);
            }
            return found;
        }, 0);
        return tempFileNames.reduce(function(chain, tempFile, index) {
            return chain.then(function() {
                const seq = nextNumber + index;
                const spoolFile = spoolFilePrefix + encodeSeq(seq) + path.extname(tempFile);
                return moveFile(tempFile, path.resolve(spoolDir, spoolFile));
            });
        }, Promise.resolve());
    });
}

/** Encode a non-negative integer, so that encoded numbers sort lexically in numeric order. */
function encodeSeq(number) {
    if (!number) {
        return '';
    }
    var result = SEQUENCE_MARK;
    var n = number;
    for (; n >= 10; n -= 10) {
        result += '9';
    }
    result += `${n}`;
    return result;
}

/** Decode a result of encodeSeq. */
function decodeSeq(str) {
    if (!str.startsWith(SEQUENCE_MARK)) {
        return 0;
    }
    return ((str.length - 2) * 10) + parseInt(str.substring(str.length - 1), 10);
}

function moveFile(source, destination) {
    return fsp.stat(destination).then(function(stats) {
        throw new Error(`${destination} already exists`);
    }, function statFailed(err) {
        log(`move ${source} to ${destination}`);
        return fsp.rename(source, destination).catch(function(err) {
            if (err.code != 'EXDEV') {
                throw err;
            }
            return fsp.copyFile(source, destination).then(function() {
                fsp.unlink(source).catch(log);
            });
        });
    });
}

function browseMessage() {
    const args = decodeCommandLine(argvSlice(4));
    return openMessage(args).then(function displayPage(pageURL) {
        if (pageURL) {
            startProcess('start', [pageURL], {shell: true, detached: true, stdio: 'ignore'});
        }
    }, function openMessageFailed(err) {
        log(err);
        // Exit swiftly, so the user will see an error message swiftly.
        return promiseTimeout(2 * seconds) // Allow time to flush the log.
            .then(function() {process.exit(2);});
    });
}

function openMessage(args) {
    const programPath = process.argv[3];
    var retries = 0;
    function tryNow() {
        return openForm(
            args
        ).catch(function tryLater(err) {
            log(err);
            if (retries >= 6) {
                throw (retries + ' retries failed ' + JSON.stringify(args));
            } else {
                ++retries;
                log('retries = ' + retries);
                if (retries == 1 || retries == 4) {
                    startProcess(programPath, ['serve'], {detached: true, stdio: 'ignore'});
                }
                return promiseTimeout(retries * seconds).then(tryNow);
            }
        });
    }
    return tryNow();
}

function openForm(args) {
    return fsp.stat(
        PortFileName
    ).catch(function(err) {
        // There's definitely no server running.
        throw PortFileName + " doesn't exist";
    }).then(function(stats) {
        return fsp.readFile(PortFileName, ENCODING);
    }).then(function(port) {
        var options = {host: LOCALHOST,
                       port: parseInt(port, 10),
                       timeout: 3 * 60 * seconds,
                       method: 'POST',
                       path: OpenOutpostMessage,
                       headers: {'Content-Type': JSON_TYPE + '; charset=' + CHARSET}};
        var postData = JSON.stringify(args);
        log('http://' + options.host + ':' + options.port
            + ' ' + options.method + ' ' + options.path + ' ' + postData);
        return httpPromise(httpExchange(options), postData);
    }).then(function(exchange) {
        const res = exchange.res;
        const data = exchange.resBody;
        if (res.statusCode == SEE_OTHER) {
            var location = res.headers.location;
            log('opened form ' + location + EOL + data);
            return location;
        } else if (res.statusCode == HTTP_OK && args.length == 0) {
            log('HTTP response ' + res.statusCode + ' ' + res.statusMessage + EOL + data);
            return null; // dry run accomplished
        } else {
            // Could be an old server, version <= 2.18,
            // or something went wrong on the server side.
            throw('HTTP response ' + res.statusCode + ' ' + res.statusMessage + EOL + data);
        }
    });
}

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
    if (options.timeout != null) {
        req.setTimeout(options.timeout);
    }
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

function startProcess(program, args, options) {
    log('startProcess(' + program + ' ' + args.join(' ') + ')');
    try {
        const child = child_process.spawn(program, args, options);
        child.on('error', function(err) {
            log(err);
        });
        if (child.disconnect) {
            child.disconnect();
        }
        child.unref();
    } catch(err) {
        log(err);
    }
}

function stopServers() {
    return fsp.readdir(
        LOG_FOLDER, {encoding: ENCODING}
    ).then(function(fileNames) {
        // Find the port numbers of all servers (including stopped servers):
        var ports = [];
        fileNames.forEach(function(fileName) {
            var found = /^server-(\d*)\.log$/.exec(fileName);
            if (found && found[1]) {
                ports.push(found[1]);
            }
            found = /-server-(\d*)\.log$/.exec(fileName);
            if (found && found[1]) {
                ports.push(found[1]);
            }
        });
        fsp.unlink(PortFileName).catch(function(err){});
        return Promise.all(ports.map(function(port) {
            log('stopping server on port ' + port);
            return httpPromise(
                httpExchange({
                    host: LOCALHOST,
                    port: parseInt(port, 10),
                    timeout: 60 * seconds,
                    method: 'POST',
                    path: StopServer
                }) // no request data
            ).catch(log); // ignore response
        }));
    }).catch(log);
}

var openForms = {'0': {quietTime: 0}}; // all the forms that are currently open
// Form 0 is a hack to make sure the server doesn't shut down immediately after starting.
var nextFormId = 1; // Forms are assigned sequence numbers when they're opened.

function serve() {
    var server = null;
    function exitSoon(err) {
        log(err);
        const exitCode = err ? 1 : 0;
        process.exitCode = exitCode;
        if (server) {
            try {
                server.close();
            } catch(err) {
                log(err);
            }
        }
        setTimeout(function() {process.exit(exitCode);}, 2 * seconds).unref();
    };
    const app = express();
    app.set('etag', false); // convenient for troubleshooting
    app.set('trust proxy', ['loopback']); // to find the IP address of a client
    app.get('/ping-:formId', function(req, res) {
        keepAlive(req.params.formId);
        noCache(res);
        res.sendStatus(NOT_FOUND); // with no body. The client ignores this response.
    });
    app.use(morgan('[:date[iso]] :method :url :status :res[content-length] - :response-time'));
    app.use(bodyParser.json({type: JSON_TYPE}));
    app.use(bodyParser.urlencoded({extended: false}));
    app.post(OpenOutpostMessage, function(req, res) {
        const args = req.body; // an array, thanks to bodyParser.json
        if (!args || !args.length) { // a dry run
            res.end();
        } else {
            formId = '' + nextFormId++;
            onOpen(
                formId, args
            ).then(function() {
                res.redirect(SEE_OTHER, 'http://' + LOCALHOST + ':' + myServerPort + '/form-' + formId);
                // This URL must be fully qualified (not relative), because
                // the client isn't a browser; it's function browseMessage,
                // which will simply pass the URL to Windows' "start" command
                // (which will open a browser).
            }, function openFailed(err) {
                log(err);
                req.socket.end(); // abort the HTTP connection
                // The client will log "Error: socket hang up" into logs/*-open.log,
                // and start another server. It would be better for the client to
                // log something more informative, but client versions <= 2.18
                // can't be induced to do that.
                res.writeHead(421, {});
            });
        }
    });
    app.get('/form-:formId', function(req, res) {
        onForm(req.params.formId, req, res);
    });
    app.post('/email-:formId', function(req, res) {
        onEmail(req.params.formId, req.body, res);
    });
    app.post('/submit-:formId', function(req, res) {
        onSubmit(req.params.formId, req, res);
    });
    app.get('/fromOutpost-:formId', function(req, res) {
        var form = openForms[req.params.formId];
        if (!form) {
            res.end();
        } else {
            // Relay the response from Outpost to the browser.
            res.set(form.fromOutpost.headers);
            res.end(form.fromOutpost.body);
        }
    });
    app.get('/msgs/:msgno', function(req, res) {
        // The client may not get the message this way,
        // since the server doesn't know what the formId is.
        res.statusCode = NOT_FOUND;
        res.end(); // with no body
    });
    app.post(StopServer, function(req, res) {
        res.end(); // with no body
        log(StopServer);
        exitSoon();
    });
    app.get('/manual', function(req, res) {
        onManual(res);
    });
    app.get('/manual-setup', function(req, res) {
        onGetManualSetup(req, res);
    });
    app.post('/manual-setup', function(req, res) {
        onPostManualSetup(req, res);
    });
    app.get('/manual-get-:pageId/:subject', function(req, res) {
        onManualGet(req.params.pageId, req, res);
    });
    app.post('/manual-create', function(req, res) {
        onManualCreate(req, res);
    });
    app.post('/manual-submit-:formId', function(req, res) {
        onManualSubmit(req.params.formId, req, res);
    });
    app.get('/manual-message-:formId', function(req, res) {
        onManualMessage(req.params.formId, req, res);
    });
    app.post('/manual-command-:formId', function(req, res) {
        onPostManualCommand(req.params.formId, req, res);
    });
    app.post('/text', function(req, res) {
        onPostReceivedEmail(req, res);
    });
    app.get('/text-:formId/:pageName', function(req, res) {
        onGetPlainText(req.params.formId, req, res);
    });
    app.post('/manual-view', function(req, res) {
        onManualView(req, res);
    });
    app.get('/manual-edit-log', function(req, res) {
        onGetManualEditLog(req, res);
    });
    app.post('/manual-edit-log', function(req, res) {
        onPostManualEditLog(req, res);
    });
    app.get('/go-back', function(req, res) {
        onGoBack(req, res);
    });
    app.get('/manual-log', function(req, res) {
        onGetManualLog(req, res);
    });
    app.get('/ICS-309.csv', function(req, res) {
        onGetManualCSV(res);
    });
    app.get('/pdf/\*.pdf', express.static('.', {setHeaders: function(res, path, stat) {
        res.set('Content-Type', 'application/pdf');
    }}));
    app.get('/bin/\*.eot', express.static('.', {setHeaders: function(res, path, stat) {
        res.set('Content-Type', 'application/vnd.ms-fontobject');
    }}));
    app.get('/bin/\*.ttf', express.static('.', {setHeaders: function(res, path, stat) {
        res.set('Content-Type', 'font/ttf');
    }}));
    app.get(/^\/.*/, express.static(PackItForms, {setHeaders: function(res, path, stat) {
        if (path) {
            const dot = path.lastIndexOf('.');
            if (dot >= 0) {
                const mimeType = {
                    css: 'text/css',
                    js: 'application/javascript',
                    pdf: 'application/pdf'
                }[path.substring(dot + 1).toLowerCase()];
                if (mimeType) {
                    res.set('Content-Type', mimeType);
                }
            }
        }
    }}));

    server = app.listen(0);
    myServerPort = server.address().port;
    if (!fs.existsSync(LOG_FOLDER)) {
        fs.mkdirSync(LOG_FOLDER);
    }
    logToFile('server-' + myServerPort);
    log('Listening for HTTP requests on port ' + myServerPort + '...');
    fsp.writeFile( // advertise my port
        PortFileName, myServerPort + '', {encoding: ENCODING}
    ).catch(log);
    const deleteMySaveFiles = function deleteMySaveFiles() {
        deleteOldFiles(SAVE_FOLDER, new RegExp('^form-' + myServerPort + '-\\d*.json$'), -seconds);
    };
    var idleTime = 0;
    const checkInterval = 5 * seconds;
    const checkSilent = setInterval(function() {
        try {
            // Scan openForms and close any that have been quiet too long.
            var anyForms = false;
            var anyOpen = false;
            for (formId in openForms) {
                var form = openForms[formId];
                if (form) {
                    anyForms = true;
                    form.quietTime += checkInterval;
                    // The client is expected to GET /ping-formId every 30 seconds.
                    if (form.quietTime >= (300 * seconds)) {
                        closeForm(formId);
                    } else {
                        anyOpen = true;
                    }
                }
            }
            if (anyOpen) {
                idleTime = 0;
            } else {
                if (anyForms) {
                    log('forms are all closed');
                }
                idleTime += checkInterval;
                if (idleTime >= (48 * hours)) {
                    log('idleTime = ' + (idleTime / hours) + ' hours');
                    clearInterval(checkSilent);
                    deleteMySaveFiles();
                    fs.readFile(PortFileName, {encoding: ENCODING}, function(err, data) {
                        if (!err && data && (data.trim() == (myServerPort + ''))) {
                            fs.unlink(PortFileName, log);
                        }
                        exitSoon();
                    });
                } else {
                    fs.readFile(PortFileName, {encoding: ENCODING}, function(err, data) {
                        if (err || (data && (data.trim() != (myServerPort + '')))) {
                            log(PortFileName + ' ' + (err ? err : data));
                            clearInterval(checkSilent);
                            deleteMySaveFiles();
                            exitSoon();
                        }
                    });
                }
            }
        } catch(err) {
            log(err);
        }
    }, checkInterval);
    deleteOldFiles(SAVE_FOLDER, /^[^\.].*$/, 60 * seconds);
}

function onOpen(formId, args) {
    // This code should be kept dead simple, since
    // it can't show a problem to the operator.
    return Promise.resolve().then(function() {
        var addon_name = undefined;
        for (var a = 0; a < args.length; ++a) {
            var nameValue = args[a].match(NameValueArg);
            if (nameValue && nameValue[1] == 'addon_name') {
                addon_name = nameValue[2];
            }
        }
        return fsp.stat(
            path.join('addons', addon_name + '.ini')
        ).catch(function(err) {
            throw new Error('This is not a server for ' + addon_name + '.');
        });
    }).then(function() {
        openForms[formId] = {
            args: args,
            quietTime: 0
        };
        log('/form-' + formId + ' opened');
    });
}

/** @return Promise<form> */
function requireForm(formId) {
    return keepAlive(formId).then(function(form) {
        if (form) return form;
        log(`form ${formId} is not open`);
        if (formId <= 0) {
            throw 'Form numbers start with 1.';
        } else if (formId < nextFormId) {
            throw new Error('Form ' + formId + ' was discarded, since it was closed.');
        } else {
            throw new Error('Form ' + formId + ' has not been opened.');
        }
    });
}

/** @return Promise<form> */
function keepAlive(formId) {
    return findForm(formId).then(function(form) {
        if (form) {
            form.quietTime = 0;
        } else if (formId == "0") {
            openForms[formId] = {quietTime: 0};
        }
        return form;
    });
}

/** @return Promise<form> */
function findForm(formId) {
    return Promise.resolve().then(function(form) {
        var form = openForms[formId];
        if (form) return form;
        const fileName = saveFileName(formId);
        return fsp.readFile(fileName, ENCODING).then(function(data) {
            form = JSON.parse(data);
            if (form) {
                openForms[formId] = form;
                log(`Read form from ${fileName}`);
            }
            return form;
        });
    }).catch(log); // and return undefined
}

function closeForm(formId) {
    const form = openForms[formId];
    delete openForms[formId];
    if (form) {
        if (!form.environment) {
            log('form ' + formId + ' = ' + JSON.stringify(form));
        } else if (form.environment.mode != 'readonly') {
            if (!fs.existsSync(SAVE_FOLDER)) {
                fs.mkdirSync(SAVE_FOLDER);
            }
            const formFileName = saveFileName(formId);
            fs.writeFile(
                formFileName, JSON.stringify(form), {encoding: ENCODING},
                function(err) {
                    log(err ? err : ('Wrote ' + formFileName));
                });
            deleteOldFiles(SAVE_FOLDER, /^form-\d+-\d+\.json$/, 7 * 24 * hours);
        }
        log('/form-' + formId + ' closed');
        if (form.environment && form.environment.MSG_FILENAME) {
            const msgFileName = path.resolve(PackItMsgs, form.environment.MSG_FILENAME);
            fs.unlink(msgFileName, function(err) {
                if (!err) log("Deleted " + msgFileName);
            });
        }
    }
}

function saveFileName(formId) {
    return path.join(SAVE_FOLDER, 'form-' + myServerPort + '-' + formId + '.json');
}

function parseArgs(args) {
    var environment = {};
    for (var i = 0; i < args.length; i++) {
        var nameValue = args[i].match(NameValueArg);
        if (nameValue) {
            environment[nameValue[1]] = nameValue[2];
        }
    }
    ['COPY_NAMES', 'MSG_INDEX', 'MSG_STATE', 'SPOOL_DIR'].forEach(function(name) {
        if (environment[name] == '{{' + name + '}}') {
            // The caller didn't provide a value for this variable.
            delete environment[name];
        }
    });
    if ((environment.MSG_STATE || '').toLowerCase() == 'undefined') {
        delete environment.MSG_STATE;
    }
    if (environment.MSG_NUMBER == '-1') { // a sentinel value
        delete environment.MSG_NUMBER;
    }
    if (environment.MSG_LOCAL_ID == '-1') { // a sentinel value
        delete environment.MSG_LOCAL_ID;
    }
    if (/^\?*$/.test(environment.MSG_DATETIME_HEADER)) { // a sentinel value
        delete environment.MSG_DATETIME_HEADER;
    }
    if (environment.message_status == 'draft' && !environment.MSG_INDEX) {
        // This probably came from an old version of Outpost.
        // Without a MSG_INDEX, the operator can't revise the message:
        environment.mode = 'readonly';
    }
    return environment;
}

function getMessage(environment) {
    return Promise.resolve(
        environment.message
    ).then(function(message) {
        if (message) {
            return message;
        } else if (environment.MSG_FILENAME) {
            const msgFileName = path.resolve(PackItMsgs, environment.MSG_FILENAME);
            return fsp.readFile(
                msgFileName, {encoding: ENCODING}
            ).then(function(message) {
                fs.unlink(msgFileName, function(err) {
                    log(err ? err : ("Deleted " + msgFileName));
                });
                // Outpost sometimes appends junk to the end of message.
                // One observed case was "You have new messages."
                return message && message.replace(
                    /[\r\n]+[ \t]*!\/ADDON![\s\S]*$/,
                    EOL + '!/ADDON!' + EOL);
            });
        } // else don't return anything.
    });
}

/** Handle an HTTP GET /form-id request. */
function onForm(formId, req, res) {
    res.set({'Content-Type': TEXT_HTML});
    var form = null;
    return requireForm(formId).then(function(foundForm) {
        form = foundForm;
        noCache(res);
        log('/form-' + formId + ' viewed');
        updateSettings();
        return loadForm(
            formId, form
        ).then(function() {
            return getForm(form, res);
        }).then(function(data) {
            res.end(data, CHARSET);
        });
    }).catch(function(err) {
        res.end(errorToHTML(err, form), CHARSET);
    });
}

function loadForm(formId, form) {
    if (!form.environment) {
        form.environment = parseArgs(form.args);
        form.environment.emailURL = '/email-' + formId;
        form.environment.submitURL =
            (form.environment.message_status == 'manual'
             ? '/manual-submit-' : '/submit-')
            + formId;
    }
    form.environment.pingURL = '/ping-' + formId;
    if (form.environment.mode != 'readonly') {
        form.environment.saveURL = '/message-' + formId;
    }
    if (form.message != null) {
        return Promise.resolve();
    }
    return getMessage(
        form.environment
    ).then(function(message) {
        form.message = message;
        if (message) {
            const parsed = parseMessage(message, form.environment);
            if (!form.environment.ADDON_MSG_TYPE) {
                form.environment.ADDON_MSG_TYPE = parsed.formType;
            }
            if (!form.environment.addon_name) {
                form.environment.addon_name = parsed.addonName;
            }
            if (!form.environment.addon_version) {
                form.environment.addon_version = parsed.addonVersion;
            }
            if (!form.environment.subject) {
                form.environment.subject = subjectFromMessage(parsed);
            }
        }
    });
}

function getForm(form, res) {
    log('getForm ' + JSON.stringify(form.environment));
    if (!form.environment.addon_name) {
        throw new Error('addon_name is ' + form.environment.addon_name + '\n');
    }
    var formType = form.environment.ADDON_MSG_TYPE;
    if (!formType) {
        throw "I don't know what form to display, since "
            + "I received " + JSON.stringify(formType)
            + " instead of the name of a form.\n";
    }
    const receiverFileName = formType.replace(/\.([^.]*)$/, '.receiver.$1');
    if (form.environment.message_status == 'received'
        && fs.existsSync(path.join(PackItForms, receiverFileName))) {
        formType = receiverFileName;
    } else {
        const readOnlyFileName = formType.replace(/\.([^.]*)$/, '.read-only.$1');
        if (form.environment.mode == 'readonly'
            && fs.existsSync(path.join(PackItForms, readOnlyFileName))) {
            formType = readOnlyFileName;
        }
    }
    return fsp.readFile(
        path.join(PackItForms, formType), ENCODING
    ).then(function(data) {
        const template = data.replace(
            /<\s*script\b[^>]*\bsrc\s*=\s*"resources\/integration\/integration.js"/,
            '<script type="text/javascript">'
                + '\n      var integrationEnvironment = ' + JSON.stringify(form.environment)
                + ';\n      var integrationMessage = ' + JSON.stringify(form.message)
                + ';\n    </script>\n    $&');
        // It would be more elegant to inject data into integration.js,
        // but sadly that file is cached by the Chrome browser.
        // So changes would be ignored by the browser, for example
        // the change to message_status after emailing a message.
        return expandDataIncludes(template, form);
    }, function readFileFailed(err) {
        throw "I don't know about a form named "
            + JSON.stringify(form.environment.ADDON_MSG_TYPE) + "."
            + " Perhaps the message came from a newer version of the "
            + form.environment.addon_name + " add-on, "
            + 'so it might help to install the latest version.'
            + '\n\n' + err;
    }).then(function(html) {
        if (form.environment.emailing) {
            form.environment.message_status = 'sent';
            delete form.environment.emailing;
        }
        return html;
    });
}

function merge(a, b) {
    if ((typeof b) == 'undefined') return a;
    if (b == null || (typeof b) != 'object' || (typeof a) != 'object') return b;
    var result = {};
    for (key in a) {
        result[key] = a[key];
    }
    for (key in b) {
        result[key] = merge(a[key], b[key]);
    }
    return result;
}

function updateSettings() {
    return fsp.stat(
        SETTINGS_FILE
    ).then(function(stats) {
        if (!stats.mtime) {
            return DEFAULT_SETTINGS;
        }
        const fileTime = stats.mtime.getTime();
        if (fileTime == settingsUpdatedTime) {
            return settings; // no change
        }
        return INI.readFile(
            SETTINGS_FILE
        ).then(function(fileSettings) {
            settingsUpdatedTime = fileTime;
            newSettings = merge(DEFAULT_SETTINGS, fileSettings);
            ['port', 'timeout'].forEach(function(name) {
                if ((typeof newSettings.Opdirect[name]) == 'string') {
                    newSettings.Opdirect[name] = parseInt(newSettings.Opdirect[name]);
                }
            });
            log('settings = ' + JSON.stringify(newSettings));
            return newSettings;
        });
    }, function statFailed(err) {
        log(err);
        return DEFAULT_SETTINGS;
    }).then(function(newSettings) {
        settings = newSettings;
    }).catch(log);
}

/* Expand data-include-html elements, for example:
  <div data-include-html="ics-header">
    {
      "5.": "PRIORITY",
      "9b.": "_.msgno2name(_.query.msgno)"
    }
  </div>
*/
function expandDataIncludes(template, form) {
    const target = /<\s*div\s+data-include-html\s*=\s*"[^"]*"\s*>[^<]*<\/\s*div\s*>/gi;
    const includes = [];
    var found;
    while(found = target.exec(template)) {
        includes.push(found);
    }
    if (includes.length <= 0) {
        // There's nothing here to expand.
        return Promise.resolve(template);
    }
    const readers = includes.map(function(found) {
        const matches = found[0].match(/"([^"]*)"\s*>([^<]*)/);
        const name = matches[1];
        const formDefaults = htmlEntities.decode(matches[2].trim());
        log('data-include-html ' + name + ' ' + formDefaults);
        // Read a file from pack-it-forms:
        const fileName = path.join(PackItForms, 'resources', 'html', name + '.html')
        return fsp.readFile(
            fileName, ENCODING
        ).then(function(data) {
            // Remove the enclosing <div></div>:
            var result = data
                .replace(/^\s*<\s*div\s*>\s*/i, '')
                .replace(/<\/\s*div\s*>\s*$/i, '');
            if (formDefaults) {
                result += `<script type="text/javascript">
  add_form_default_values(${formDefaults});
</script>
`;
            }
            return { // one replacement
                first: found.index,
                newData: result,
                next: found.index + found[0].length
            };
        });
    });
    return Promise.all(
        readers
    ).then(function(replacements) {
        var next = 0;
        var chunks = [];
        replacements.forEach(function(replacement) {
            chunks.push(template.substring(next, replacement.first));
            chunks.push(replacement.newData);
            next = replacement.next;
        });
        chunks.push(template.substring(next));
        // Try it again, in case there are nested includes:
        return expandDataIncludes(chunks.join(''), form);
    });
}

function noCache(res) {
    res.set({'Cache-Control': 'no-cache, no-store, must-revalidate', // HTTP 1.1
             'Pragma': 'no-cache', // HTTP 1.0
             'Expires': '0'}); // proxies
}

function onEmail(formId, reqBody, res) {
    const message = reqBody.formtext;
    var form = null;
    return requireForm(formId).then(function(foundForm) {
        form = foundForm;
        form.message = message;
        form.environment.emailing = true;
        form.environment.subject =
            reqBody.subject || subjectFromMessage(parseMessage(message, form.environment));
        form.environment.mode = 'readonly';
        res.redirect('/form-' + formId);
    }).catch(function(err) {
        res.set({'Content-Type': TEXT_HTML});
        res.end(errorToHTML(err, form || message), CHARSET);
    });
}

/** Change Unix style line endings to Windows style. */
function toEOL(from) {
    return from && from
        .replace(/([^\r])\n/g, '$1' + EOL)
        .replace(/([^\r])\n/g, '$1' + EOL);
    // You have to do it twice to handle multiple consecutive blank lines.
}

function saveForm(form, req) {
    const reqBody = req.body;
    const message = reqBody.formtext;
    form.environment.subject = reqBody.subject
        || subjectFromMessage(parseMessage(message, form.environment));
    // Outpost requires Windows-style line breaks:
    form.message = toEOL(message);
    log(`saveForm ${form.message.length}`);
}

function isUrgent(message) {
    if (!message) {
        return false;
    }
    const parsed = parseEmail(message);
    const handling = parsed.fields['5.'] || '';
    return (['IMMEDIATE', 'I'].indexOf(handling) >= 0);
}

function onSubmit(formId, req, res) {
    var form = null;
    return requireForm(formId).then(function(foundForm) {
        form = foundForm;
        const message = req.body.formtext;
        saveForm(form, req);
        const submission = {
            formId: formId,
            form: form,
            addonName: form.environment.addon_name,
            subject: form.environment.subject,
            urgent: isUrgent(message, form.environment)
        };
        return submitToOpdirect(submission, messageForOpdirect(submission));
    }).then(
        respondFromOpdirect
    ).then(function(fromOutpost) {
        log(`/submit-${formId} from Outpost ` + JSON.stringify(fromOutpost));
        if (fromOutpost) {
            res.set({'Content-Type': TEXT_HTML});
            form.fromOutpost = fromOutpost;
            fromOutpostURL = `http://${req.get('host')}/fromOutpost-${formId}`
            var page = PROBLEM_HEADER + EOL
                + 'When the message was submitted, Outpost responded:<br/><br/>' + EOL
                + '<iframe src="' + fromOutpostURL + '" style="width:95%;"></iframe><br/><br/>' + EOL;
            if (fromOutpost.message) {
                page += encodeHTML(fromOutpost.message)
                    .replace(/[\r\n]+/g, '<br/>' + EOL) + '<br/>' + EOL;
            }
            if (logFileName) {
                page += encodeHTML('log file ' + logFileName) + '<br/>' + EOL;
            }
            page += '</body></html>';
            res.end(page, CHARSET);
        } else {
            form.environment.mode = 'readonly';
            // Don't closeForm, so the operator can view it.
            // But do delete its save file (if any):
            const fileName = saveFileName(formId);
            fsp.unlink(fileName).then(function() {
                log("Deleted " + fileName);
            });
            res.redirect('/form-' + formId);
        }
    }).catch(function(err) {
        res.set({'Content-Type': TEXT_HTML});
        res.end(errorToHTML(err, form && form.environment), CHARSET);
    });
}

function messageForOpdirect(submission) {
    if (!submission.addonName) throw 'addonName is required.\n'; 
    // Outpost requires parameters to appear in a specific order.
    // So don't stringify them from a single object.
    var body = querystring.stringify({adn: submission.addonName});
    if (submission.form.environment.MSG_INDEX) {
        body += '&' + querystring.stringify({upd: (submission.form.environment.MSG_INDEX)});
    }
    if (submission.subject) {
        body += '&' + querystring.stringify({sub: (submission.subject)});
    }
    body += '&' + querystring.stringify({urg: submission.urgent ? 'TRUE' : 'FALSE'});
    if (submission.form.message) {
        body += '&' + querystring.stringify({msg: submission.form.message});
    }
    return body;
}

/** Evaluate the response from submitting a message to Opdirect.
    @return null if and only if the response looks successful.
*/
function respondFromOpdirect(exchange) {
    if (exchange == null) return null;
    const res = exchange.res;
    const data = exchange.resBody || '';
    if (data.indexOf('Your PacFORMS submission was successful!') >= 0) {
        return {message: "That's an obsolete version of Outpost, it appears.",
                headers: copyHeaders(res.headers),
                body: data};
    } else if (res.statusCode < HTTP_OK || res.statusCode >= 300) {
        return {message: 'HTTP status ' + res.statusCode + ' ' + res.statusMessage,
                headers: copyHeaders(res.headers),
                body: data};
    }
    var returnCode = 0;
    // Look for <meta name="OpDirectReturnCode" content="403"> in the body:
    var matches = data.match(/<\s*meta\s+[^>]*\bname\s*=\s*"OpDirectReturnCode"[^>]*/i);
    if (matches) {
        matches = matches[0].match(/\s+content\s*=\s*"\s*([^"]*)\s*"/i);
        if (matches) {
            returnCode = parseInt(matches[1]);
        }
    }
    if (returnCode < HTTP_OK || returnCode >= 300) {
        return {message: 'OpDirectReturnCode ' + returnCode,
                headers: copyHeaders(res.headers),
                body: data};
    } else {
        return null;
    }
}

/** @return a Promise, which will be an httpPromise if all goes well,
    or rejected if something goes wrong.
*/
function submitToOpdirect(submission, body) {
    const context = submission.formId ? ('/form-' + submission.formId + ' ') : '';
    const options = settings.Opdirect;
    return Promise.resolve().then(function() {
        // URL encode the 'E' in '#EOF', to prevent Outpost from treating this as a PacFORM message:
        body = body.replace(/%23EOF/gi, function(match) {
            // Case insensitive:
            return '%23' + {E: '%45', e: '%65'}[match.substring(3, 1)] + match.substring(4);
        });
        // Mark the end of the request body. This must be the last parameter:
        body += '&' + querystring.stringify({'4VAO': '\r\n#EOF'});
        // The #EOF value makes the request fail fast if the server is an old version of Outpost.
        // An old server recognizes %23EOF as an end-of-message marker, decodes the body,
        // finds there is no parameter named formtext and fails.
        // A new server recognizes &4VAO= as the end-of-message marker.
        // Either server ignores the HTTP Content-Length header; it just scans for the marker.
        // Send an HTTP request.
        log(context + 'to Outpost ' + JSON.stringify(options) + ' ' + body);
        const exchange = httpExchange(options);
        exchange.req.setHeader('Content-Type', 'application/x-www-form-urlencoded');
        return httpPromise(exchange, body);
    }).catch(function(err) {
        if (err == 'req.timeout' || err == 'res.timeout') {
            throw "Opdirect didn't respond within " + options.timeout + ' milliseconds.'
                + EOL + JSON.stringify(options);
        } else if ((err + '').indexOf(' ECONNREFUSED ') >= 0) {
            throw "Opdirect isn't running, it appears."
                + EOL + JSON.stringify(options)
                + EOL + err;
        } else {
            throw err;
        }
    });
}

/** Handle an HTTP GET /manual request. */
function onManual(res) {
    keepAlive(0);
    res.set({'Content-Type': TEXT_HTML});
    const templateFile = path.join('bin', 'manual.html');
    return fsp.readFile(
        templateFile, {encoding: ENCODING}
    ).then(function(template) {
        return getAddonForms().then(function(forms) {
            var form_options = forms
                .filter(function(form) {return !!form.t;})
                .map(function(form) {
                    return EOL
                        + '<option value="'
                        + encodeHTML(form.t)
                        + '">'
                        + encodeHTML(form.fn ? form.fn.replace(/_/g, ' ') : form.t)
                        + '</option>';
                });
            const pageId = '' + nextFormId++;
            openForms[pageId] = {quietTime: 0};
            res.end(expandVariables(template, {
                form_options: form_options.join(''),
                pageId: pageId}));
        });
    }).catch(function(err) {
        res.end(errorToHTML(err, templateFile));
    });
}

var manualDataFolder = null;

function findManualDataFolder() {
    if (manualDataFolder != null) {
        return Promise.resolve(manualDataFolder);
    }
    var appData = process.env.APPDATA;
    if (!appData) {
        manualDataFolder = LOG_FOLDER;
        log(`manualDataFolder = ${manualDataFolder}; %APPDATA% = ${appData}`);
        return Promise.resolve(manualDataFolder);
    }
    appData = path.join(appData, 'PackItForms');
    var testFile = path.join(appData, 'test.txt');
    return fsp.checkFolder(
        appData
    ).then(function() {
        return fsp.writeFile(testFile, 'test', {encoding: ENCODING});
    }).then(function(OK) {
        fsp.unlink(testFile); // asynchronously
        manualDataFolder = appData;
        log(`manualDataFolder = ${manualDataFolder}`);
        return manualDataFolder;
    }).catch(function(err) {
        log(err);
        log(`... in findManualDataFolder`);
        manualDataFolder = LOG_FOLDER;
        log(`manualDataFolder = ${manualDataFolder}`);
        return manualDataFolder;
    });
}

function findManualLogFile() {
    return findManualDataFolder().then(function(folder) {
        return path.join(folder, 'manual-log.json');
    });
}

function findManualSettingsFile() {
    return findManualDataFolder().then(function(folder) {
        return path.join(folder, 'manual-settings.json');
    });
}

function setManualSettings(settings) {
    const json = JSON.stringify(settings);
    try {
        findManualSettingsFile().then(function(file) {
            return fsp.writeFile(file, json, {encoding: ENCODING});
        }).catch(function(err) {
            log(err);
            log(`... in setManualSettings ${json}`);
        });
    } catch(err) {
        log(err);
        log(`... in setManualSettings ${json}`);
    }
}

function getManualSettings() {
    return findManualSettingsFile().then(function(file) {
        return fsp.readFile(file, {encoding: ENCODING});
    }).then(
        JSON.parse
    ).catch(function(err) {
        log(err);
        return null;
    }).then(function(settings) {
        if (settings) {
            return settings;
        }
        return getInitialManualSettings(function(settings) {
            setManualSettings(settings);
            return setinngs;
        });
    }).then(function(settings) {
        if (settings.useTac) {
            settings.call = settings.tacCall;
            settings.name = settings.tacName;
            settings.prefix = settings.tacPrefix;
        } else {
            settings.call = settings.opCall;
            settings.name = settings.opName;
            settings.prefix = settings.opPrefix;
        }
        return settings;
    });
}

function getInitialManualSettings() {
    const settings = {
        nextMessageNumber: 1,
        opName: '',
        opCall: '',
        opPrefix: '',
        tacName: '',
        tacCall: '',
        tacPrefix: '',
        useTac: false,
    };
    return INI.readFile(
        'C:/Program Files (x86)/SCCo Packet/Outpost.conf'
    ).then(function(conf) {
        return INI.readFile(path.join(conf.DataDirectory.DataDir, 'Outpost.profile'));
    }).then(function(profile) {
        const ini = profile.IDENTIFICATION;
        if (ini) {
            settings.opName = ini.UsrName || '';
            settings.opCall = ini.UsrCall || '';
            settings.opPrefix = ini.UsrID || '';
            settings.tacName = ini.TacName || '';
            settings.tacCall = ini.TacCall || '';
            settings.tacPrefix = ini.TacID || '';
            settings.useTac = (
                ini.ActMyCall
                    && ini.ActMyCall == ini.TacCall
                    && ini.ActMyName
                    && ini.ActMyName == ini.TacName
            );
        }
        return settings;
    }).catch(function(err) {
        log(err);
        return settings;
    });
}

function onGetManualSetup(req, res) {
    res.set({'Content-Type': TEXT_HTML});
    return getManualSettings().then(function(settings) {
        return fsp.readFile(
            path.join('bin', 'manual-setup.html'), {encoding: ENCODING}
        ).then(function(template) {
            res.end(expandVariables(template, settings), CHARSET);
        });
    }).catch(function(err) {
        res.end(errorToHTML(err, templateFile), CHARSET);
    });
}

function sendWindowClose(res) {
    res.end('<!DOCTYPE html>'
            + EOL + '<html><head>'
            + EOL + '<meta http-equiv="Content-Type" content="text/html;charset=UTF-8">'
            + EOL + '<script type="text/javascript">window.close();</script>'
            + EOL + '</head></html>',
            CHARSET);
}

function onPostManualSetup(req, res) {
    res.set({'Content-Type': TEXT_HTML});
    const id = {};
    return getManualSettings().then(function(settings) {
        for (field in req.body) {
            settings[field] = req.body[field];
        }
        settings.useTac = !!req.body.useTac; // coerce to boolean
        setManualSettings(settings);
        log('onPostManualSetup ' + JSON.stringify(settings));
        if (req.body.nextPage) {
            res.redirect(SEE_OTHER, req.body.nextPage);
        } else {
            sendWindowClose(res);
        }
    }).catch(function(err) {
        res.end(errorToHTML(err, id), CHARSET);
    });
}

function onManualPut(pageId, req, res) {
    var form = null;
    return requireForm(pageId).then(function(foundForm) {
        form = foundForm;
        var lengths = {};
        if (req.body) {
            for (name in req.body) {
                var value = req.body[name];
                form[name] = value;
                lengths[name] = value.length;
            }
        }
        res.set({'Content-Type': TEXT_PLAIN});
        res.end('put ' + JSON.stringify(lengths));
    }).catch(function(err) {
        res.set({'Content-Type': TEXT_HTML});
        res.end(errorToHTML(err, form && form.environment), CHARSET);
    });
}

function onManualGet(pageId, req, res) {
    var form = null;
    noCache(res);
    return requireForm(pageId).then(function(foundForm) {
        form = foundForm;
        value = toEOL(form[req.query.field || 'message']);
        res.set({'Content-Type': TEXT_PLAIN});
        res.end(value, CHARSET);
    }).catch(function(err) {
        res.set({'Content-Type': TEXT_HTML});
        res.end(errorToHTML(err, form && form.environment), CHARSET);
    });
}

function padStart(s, len, pad) {
    var result = '' + s;
    while (result.length < len) {
        result = pad + result;
    }
    return result;
}

function nextManualMessageNumber(settings) {
    const number = padStart('' + (settings.nextMessageNumber++), 3, '0');
    setManualSettings(settings);
    return `${settings.prefix}-${number}M`;
}

function onManualCreate(req, res) {
    const formId = '' + nextFormId++;
    const plainText = (req.body.ADDON_MSG_TYPE == "/plainText");
    return getManualSettings().then(function(settings) {
        const msgNumber = nextManualMessageNumber(settings);
        const environment = {
            message_status: 'manual',
            MSG_NUMBER: msgNumber,
            subject: `${msgNumber}_R_`,
            active_name: settings.name,
            active_call_sign: settings.call,
            operator_name: settings.opName,
            operator_call_sign: settings.opCall,
            tactical_name: settings.tacName,
            tactical_call_sign: settings.tacCall,
        };
        for (var field in req.body) {
            environment[field] = req.body[field];
        }
        if (plainText) {
            environment.readOnly = false;
            openForms[formId] = {
                quietTime: 0,
                environment: environment,
                args: [],
            };
        } else {
            const args = [];
            for (var field in environment) {
                args.push(`--${field}-${environment[field]}`);
            }
            return onOpen(formId, args);
        }
    }).then(function() {
        res.redirect((plainText ? '/manual-message-' : '/form-') + formId);
    }, function openFailed(err) {
        res.set({'Content-Type': TEXT_HTML});
        res.end(errorToHTML(err, JSON.stringify(req.body)), CHARSET);
    });
}

function onManualView(req, res) {
    const formId = '' + nextFormId++;
    return getManualSettings().then(function(settings) {
        const input = {
            MSG_LOCAL_ID: nextManualMessageNumber(settings),
            operator_name: settings.opName,
            operator_call_sign: settings.opCall,
        };
        for (var name in req.body) {
            input[name] = req.body[name];
        }
        if (input.OpDate && input.OpTime) {
            input.MSG_DATETIME_OP_RCVD = `${input.OpDate} ${input.OpTime}`;
        }
        const parsed = (input.message == null) ? null : parseEmail(input.message);
        if (parsed) {
            input.subject = parsed.headers.subject;
            var from = parsed.headers.from;
            if (from) {
                var found = /<([^>]*)>/.exec(from);
                if (found) {
                    from = found[1];
                }
                var atSign = from.indexOf('@');
                if (atSign < 0) {
                    input.MSG_FROM_LOCAL = from;
                } else {
                    input.MSG_FROM_LOCAL = from.substring(0, atSign);
                    input.MSG_FROM_FQDN = from.substring(atSign + 1);
                }
            }
            // MSG_DATETIME_HEADER could be copied from parsed.headers.date.
            // But it's unnecessary.
        }
        logManualView(settings, input, parsed); // asynchronously
        if (messageContainsAForm(parsed, input)) {
            if (input.addon_name) {
                // Perhaps there's extra text at the beginning of the message,
                // for example email headers like From or Subject.
                var start = enquoteRegex('!' + input.addon_name + '!') + '[\r\n]';
                var pattern = new RegExp(start);
                var foundIt = pattern.exec(input.message);
                if (foundIt) {
                    // Ignore the surplus text preceding start:
                    input.message = input.message.substring(foundIt.index);
                }
            }
            var args = ['--message_status-received', '--mode-readonly'];
            for (var name in input) {
                args.push('--' + name + '-' + input[name]);
            }
            return onOpen(formId, args).then(function() {
                res.redirect('/form-' + formId);
            });
        } else { // message does not contain a form
            openForms[formId] = {
                quietTime: 0,
                plainText: input.message || '',
            };
            const subject = encodeURIComponent(subjectFromEmail(parsed) || 'message');
            res.redirect(SEE_OTHER, `/text-${formId}/${subject}.txt`);
            // redirects to onGetPlainText
        }
    }).catch(function(err) {
        res.set({'Content-Type': TEXT_HTML});
        res.end(errorToHTML(err, JSON.stringify(req.body)), CHARSET);
    });
}

function onManualSubmit(formId, req, res) {
    var form = null;
    return requireForm(formId).then(function(foundForm) {
        form = foundForm;
        form.environment.readOnly = true;
        saveForm(form, req);
        res.redirect('/manual-message-' + formId);
    }).catch(function(err) {
        res.set({'Content-Type': TEXT_HTML});
        res.end(errorToHTML(err, form && form.environment), CHARSET);
    });
}

function onManualMessage(formId, req, res) {
    var form = null;
    res.set({'Content-Type': TEXT_HTML});
    return requireForm(formId).then(function(foundForm) {
        form = foundForm;
        log('onManualMessage ' + JSON.stringify(form));
        const templateFile = path.join('bin', 'message.html');
        return fsp.readFile(templateFile, {encoding: ENCODING});
    }).then(function(template) {
        res.end(expandVariables(template, {
            readOnly: `${!!form.environment.readOnly}`,
            pingURL: `'/ping-${formId}'`, // a javascript expression
            Urgent: `${isUrgent(form.message, form.environment)}`,
            Subject: encodeHTML(form.environment.subject || ''),
            Message: encodeHTML(form.message || ''),
            CommandURL: `/manual-command-${formId}`,
        }), CHARSET);
    }).catch(function(err) {
        res.end(errorToHTML(err, form && form.environment), CHARSET);
    });
}

const manualLogFieldNames = [
    'incidentName',
    'activationNumber',
    'fromDate',
    'fromTime',
    'toDate',
    'toTime',
    'netName',
    'opName',
    'opCall',
    'preparerName',
    'preparerCall',
    'datePrepared',
    'timePrepared',
];

const manualLogFieldClasses = {
    fromDate: 'date',
    fromTime: 'time',
    toDate: 'date',
    toTime: 'time',
    opCall: 'call-sign',
    preparerCall: 'call-sign',
    datePrepared: 'date',
    timePrepared: 'time',
};

const manualLogMessageFieldNames = [
    'time', 'fromCall', 'fromNumber', 'toCall', 'toNumber', 'subject'
];

const manualLogMessageFieldClasses = {
    date: 'date',
    time: 'time',
    fromCall: 'call-sign',
    toCall: 'call-sign',
    fromNumber: 'message-number',
    toNumber: 'message-number',
};

const manualLogMessageFieldWidths = {
    time: '6ex',
    fromCall: '8ex',
    toCall: '8ex',
    fromNumber: '11ex',
    toNumber: '11ex',
};

function subjectFromEmail(message) {
    if (!message) {
        return null;
    }
    var subject = message.headers.subject;
    if (!subject) {
        subject = message.formType || '';
        if (subject.startsWith('form-')) {
            subject = subject.substring(5);
        }
        if (subject.endsWith('.html')) {
            subject = subject.substring(0, subject.length - 5);
        }
    }
    return subject;
}

function getMessageNumberFromSubject(subject) {
    var found = /^(([A-Z0-9]{1,3}-)?\d+[A-Z]?)_/i.exec(subject);
    return (found && found[1]) || '';
}

function trimSubject(fromSubject, msgNo) {
    var subject = fromSubject;
    const found = /^[A-Z0-9]{1,3}-\d+[A-Z]?_/i.exec(subject);
    if (found) { // Remove msgNo from subject.
        subject = subject.substring(found[0].length);
    }
    if (subject.length > 40) {
        subject = subject.substring(0, 37) + '...';
    }
    // log(`trimSubject(${fromSubject}, ${msgNo}) = ${subject}`);
    return subject;
}

function dateFromDate(when) {
    return padStart(when.getMonth() + 1, 2, '0')
        + '/' + padStart(when.getDate(), 2, '0')
        + '/' + when.getFullYear();
}

function timeFromDate(when) {
    return padStart(when.getHours(), 2, '0')
        + ':' + padStart(when.getMinutes(), 2, '0');
}

function trimAddress(c) {
    if (c == null) return c;
    const found = TrimAddress.exec(c);
    return found ? found[0].trim() : c;
}

function firstAddress(x) {
    if (!x) return x;
    const found = x.split(/[,;]/)
          .map(function(y) {return y.trim();})
          .filter(function(y) {return !!y;});
    return (found.length > 0) ? found[0] : '';
}

function logManualView(settings, input, message) {
    log('logManualView ' + JSON.stringify(message));
    return readManualLog().then(function(theLog) {
        const subject = input.subject || subjectFromEmail(message) || '';
        const fields = message.fields;
        const fromNumber = fields.MsgNo || getMessageNumberFromSubject(subject) || '';
        const now = new Date();
        const logEntry = {
            date: input.OpDate || dateFromDate(now),
            time: input.OpTime || timeFromDate(now),
            fromCall: trimAddress(message.headers.from) || fields.OpCall || '',
            fromNumber: fromNumber,
            toCall: settings.call || trimAddress(firstAddress(message.headers.to)) || '',
            toNumber: input.MSG_LOCAL_ID || '',
            subject: trimSubject(subject, fromNumber),
        };
        theLog.messages.push(logEntry);
        return findManualLogFile().then(function(logFile) {
            return fsp.writeFile(
                logFile, JSON.stringify(theLog), {encoding: ENCODING}
            );
        });
    }).catch(log);
}

function logManualSend(form, addresses) {
    log('logManualSend(' + JSON.stringify(form) + ', ' + JSON.stringify(addresses) + ')');
    return readManualLog().then(function(data) {
        const message = parseEmail(form.message);
        const subject = form.environment.subject || subjectFromEmail(message);
        const fromNumber = message.fields.MsgNo || getMessageNumberFromSubject(subject);
        for (a in addresses) {
            var item = {toCall: trimAddress(addresses[a])};
            if (a > 0) {
                item.time = '"'; // ditto
                item.fromCall = '"';
                item.fromNumber = '"';
            } else {
                var now = new Date();
                item.date = dateFromDate(now);
                item.time = timeFromDate(now);
                item.fromCall = form.environment.active_call_sign;
                item.fromNumber = fromNumber;
                item.subject = trimSubject(subject, fromNumber);
            }
            data.messages.push(item);
        }
        try {
            var found = /^[A-Z0-9]{1,3}?-(\d+)/i.exec(fromNumber);
            if (found) {
                nextNumber = parseInt(found[1], 10) + 1;
                getManualSettings().then(function(settings) {
                    if (settings.nextMessageNumber != nextNumber) {
                        settings.nextMessageNumber = nextNumber;
                        setManualSettings(settings);
                    }
                });
            }
        } catch(err) {
            log(err);
        }
        return findManualLogFile().then(function(logFile) {
            return fsp.writeFile(
                logFile, JSON.stringify(data), {encoding: ENCODING}
            );
        });
    }).catch(log);
}

function onGetManualEditLog(req, res) {
    return readManualLog().then(function(data) {
        return getManualSettings().then(function(settings) {
            manualLogFieldNames.forEach(function(field) {
                var clazz = manualLogFieldClasses[field];
                var attrs = '';
                if (clazz) {
                    attrs += ` class="${clazz}" placeholder="${clazz}"`;
                }
                if (field == 'opName') {
                    attrs += ' style="width:15em;" placeholder="name"';
                }
                if (field == 'preparerName') {
                    attrs += ' style="width:10em;" placeholder="name"';
                }
                data[field] = `<input type="text" name="`
                    + encodeHTML(field)
                    + `"${attrs} value="`
                    + encodeHTML(data[field] || '')
                    + `" required/>` ;
            });
            data.radioOperator =
                '<table class="same-line-label-layout"><tr>'
                + `${EOL} <td style="width:1px;">${data.opName}</td>`
                + `${EOL} <td style="width:1px;padding-left:0px;">,</td>`
                + `${EOL} <td>${data.opCall}</td>`
                + `${EOL}</tr></table>`;
            data.preparedBy =
                '<table class="same-line-label-layout"><tr>'
                + `${EOL} <td style="width:1px;">${data.preparerName}</td>`
                + `${EOL} <td style="width:1px;padding-left:0px;">,</td>`
                + `${EOL} <td>${data.preparerCall}</td>`
                + `${EOL}</tr></table>`;
            data.signature = '<div style="padding-top:0.5em;"><label style="font-weight:normal;">'
                + '<input type="checkbox" name="withSignature" value="true"/>'
                + 'print signature</label></div>';
            return data;
        });
    }).then(function(data) {
        data.messages.push(null); // enable adding a row at the end
        var messageRows = '';
        for (m in data.messages) {
            var message = data.messages[m];
            messageRows += `</tr><tr class="`
                + (message == null ? "message-blank" : "message-edit")
                + `">${EOL}`;
            manualLogMessageFieldNames.forEach(function(field) {
                var clazz = manualLogMessageFieldClasses[field];
                var attrs = clazz ? ` class="${clazz}"` : '';
                if (clazz == 'time' && message != null) {
                    attrs += ' required';
                }
                var input = `<input type="text" name="`
                    + encodeHTML(`${m}.${field}`)
                    + `"${attrs} value="`
                    + encodeHTML((message && message[field]) || '')
                    + `"/>` ;
                attrs = (clazz && m == 0) ? ` style="width:1px;"` : '';
                messageRows += `  <td${attrs}>${input}</td>${EOL}`;
            });
            messageRows += '  <td style="width:1px;">'
            if (message != null) {
                messageRows +=
                    `<button onclick="deleteMessage(${m})" title="Delete this row"`
                    + ' style="background-color:#ffcccc;">'
                    + '<img alt="-" src="icon-delete.png"/>'
                    + '</button>';
            }
            messageRows += `</td>${EOL}`
                + '  <td style="width:1px;">'
                + `<button onclick="insertMessage(${m})" title="Insert a row">`
                + '<img alt="+" src="icon-insert.png"/></button>'
                + `</td>${EOL}`;
        }
        data.messages = messageRows;
        data.afterLoad = '';
        data.submitButtons = '<td style="width:1px;">'
            + EOL + '  <button onclick="eraseAll()" style="background-color:#ffcccc;"'
            + ' title="Clear all fields and delete all log entries!"'
            + '>Erase All</button>'
            + EOL + '</td><td style="width:1px;">'
            + EOL + '  <input type="submit" name="csvButton" value="Download CSV File"/>'
            + EOL + '</td><td style="width:1px;">'
            + EOL + '  <input type="submit" name="printButton" value="Print"/>'
            + EOL + '</td><td style="width:1px;">'
            + EOL + '  <input type="submit" name="saveButton" value="Save"/>'
            + EOL + '</td>';
        return sendManualLog(res, data);
    }).catch(function(err) {
        res.set({'Content-Type': TEXT_HTML});
        res.end(errorToHTML(err), CHARSET);
    });
}

function onPostManualEditLog(req, res) {
    function getManualLogMessage(req, m, message) {
        var empty = true;
        manualLogMessageFieldNames.forEach(function(field) {
            message[field] = req.body[`${m}.${field}`];
            empty = empty && !(message[field]);
        });
        if (!message.date && message.time != '"') {
            message.date = dateFromDate(new Date());
        }
        return !empty;
    }
    return readManualLog().then(function(data) {
        manualLogFieldNames.forEach(function(field) {
            data[field] = req.body[field];
        });
        // Have messages been deleted, e.g. by the 'Erase All' button?
        var m;
        for (m = data.messages.length; m > 0; --m) {
            if (req.body[`${m - 1}.time`] != null) {
                break;
            }
        }
        if (m < data.messages.length) { // messages were deleted
            data.messages = data.messages.slice(0, m);
        }
        for (m in data.messages) {
            getManualLogMessage(req, m, data.messages[m]);
        }
        var newMessage = {};
        var addedMessage = getManualLogMessage(req, data.messages.length, newMessage);
        if (addedMessage) {
            data.messages.push(newMessage);
        }
        if (req.body.insertIndex) {
            var i = parseInt(req.body.insertIndex);
            // If we just added a message and inserted at the new message index,
            // don't insert another item into data.messages.
            if (i < data.messages.length + (addedMessage ? -1 : 1)) {
                data.messages.splice(i, 0, {});
            }
        }
        if (req.body.deleteIndex) {
            data.messages.splice(parseInt(req.body.deleteIndex), 1);
        }
        const newData = JSON.stringify(data);
        log(`onPostManualEditLog data ${newData}`);
        return findManualLogFile().then(function(logFile) {
            return fsp.writeFile(logFile, newData, {encoding: ENCODING});
        });
    }).then(function() {
        if (req.body.printButton) {
            res.redirect(SEE_OTHER, '/manual-log' + (req.body.withSignature ? '?withSignature=true' : ''));
        } else if (req.body.csvButton) {
            res.redirect(SEE_OTHER, '/ICS-309.csv');
        } else if (req.body.saveButton) {
            sendWindowClose(res);
        } else {
            res.redirect(SEE_OTHER, req.headers.referer);
        }
    }).catch(function(err) {
        res.end(errorToHTML(err), CHARSET);
    });
}

function onGoBack(req, res) {
    res.set({'Content-Type': TEXT_HTML});
    res.end('<!DOCTYPE html>'
            + EOL + '<html><head>'
            + EOL + '<meta http-equiv="Content-Type" content="text/html;charset=UTF-8">'
            + EOL + '<script type="text/javascript">history.back();</script>'
            + EOL + '</head></html>',
            CHARSET);
}

function onGetManualLog(req, res) {
    return readManualLog().then(function(data) {
        log(`onGetManualLog data ${JSON.stringify(data)}`);
        data.radioOperator = encodeHTML((data.opName || '') + ', ' + (data.opCall || ''));
        data.preparedBy = encodeHTML((data.preparerName || '') + ', ' + (data.preparerCall || ''));
        data.signature = (req.query.withSignature && data.preparerName)
            ? (`<div style="font-family:'Pacifico','Brush Script MT',cursive;padding-top:0.25em;">`
               + encodeHTML(data.preparerName || '')
               + '</div>')
            : '';
        manualLogFieldNames.forEach(function(field) {
            data[field] = data[field] ? encodeHTML(data[field]) : '&nbsp;';
        });
        var messageRows = '';
        data.messages.forEach(function(message) {
            var firstRow = !messageRows;
            messageRows += `</tr><tr class="message-data">${EOL}`;
            manualLogMessageFieldNames.forEach(function(field) {
                var attrs = '';
                if (field == 'subject') {
                    attrs += ' colspan="3"';
                }
                var width = manualLogMessageFieldWidths[field];
                if (width && firstRow) {
                    attrs += ` style="width:${width};"`;
                }
                messageRows += `<td${attrs}>`
                    + (message[field] ? encodeHTML(message[field]) : '&nbsp;')
                    + `</td>${EOL}`;
            });
        });
        data.messages = messageRows;
        data.afterLoad = 'window.print();';
        data.submitButtons = '';
        return sendManualLog(res, data);
    }).catch(function(err) {
        res.set({'Content-Type': TEXT_HTML});
        res.end(errorToHTML(err), CHARSET);
    });
}

function onGetManualCSV(res) {
    return readManualLog().then(function(data) {
        log(`onGetManualCSV data ${data}`);
        manualLogFieldNames.forEach(function(field) {
            data[field] = enquoteCSV(data[field]);
        });
        var messageRows = '';
        data.messages.forEach(function(message) {
            message.time = (message.date || '') + ' ' + message.time;
            manualLogMessageFieldNames.forEach(function(field) {
                message[field] = enquoteCSV(message[field]);
            });
            messageRows += message.time
                + ',' + message.fromCall
                + ',' + message.toCall
                + ',' + message.fromNumber
                + ',' + message.toNumber
                + ',' + message.subject + EOL;
        });
        data.messages = messageRows;
        return fsp.readFile(
            path.join('bin', 'manual-log.csv'), {encoding: ENCODING}
        ).then(function(template) {
            const csv = expandVariables(template, data);
            res.set({'Content-Type': TEXT_PLAIN});
            res.end(csv, CHARSET);
        });
    }).catch(function(err) {
        res.set({'Content-Type': TEXT_HTML});
        res.end(errorToHTML(err), CHARSET);
    });
}

function enquoteCSV(value) {
    if (value && value.match(/[,"]/)) {
        return '"' + value.replace(/"/g, '""') + '"';
    } else {
        return value || '';
    }
}

function sendManualLog(res, data) {
    res.set({'Content-Type': TEXT_HTML});
    return fsp.readFile(
        path.join('bin', 'manual-log.html'), {encoding: ENCODING}
    ).then(function(template) {
        res.end(expandVariables(template, data), CHARSET);
    });
}

function readManualLog() {
    return findManualLogFile().then(function(logFile) {
        return fsp.readFile(logFile, {encoding: ENCODING});
    }).then(function(data) {
        var theLog = JSON.parse(data);
        if (!theLog.messages) {
            theLog.messages = [];
        }
        return theLog;
    }, function readFailed(err) {
        log(err);
        return {messages: []};
    });
}

function onPostManualCommand(formId, req, res) {
    return requireForm(formId).then(function(form) {
        log('onPostManualCommand ' + JSON.stringify(req.body));
        const urgent = (req.body.urgent == "true");
        const bulletin = (req.body.bulletin == "true");
        const message = req.body.message || '';
        const suffix = (message.endsWith('\n') ? '' : EOL) + `/EX${EOL}`;
        const addresses = [];
        req.body.to.split(/[,;]/).forEach(function(item) {
            var address = item.trim();
            if (address) {
                addresses.push(address);
            }
        });
        var prefix = '';
        switch(addresses.length) {
        case 0:
        case 1:
            prefix = (bulletin ? 'SB ' : 'SP ') + (addresses[0] || '<address>');
            break;
        default:
            prefix = 'SC ' + addresses[0] + EOL + addresses.slice(1).join(',');
            break;
        }
        const subject = req.body.subject.replace(/\r?\n/g, ' ');
        prefix += `${EOL}${subject}${EOL}` + (urgent ? '!URG!' : '');
        form.environment.subject = subject;
        form.message = message;
        form.plainText = prefix + message + suffix;
        logManualSend(form, addresses);
        res.redirect(SEE_OTHER, `/text-${formId}/`
                     + encodeURIComponent(subject)
                     + '.txt');
    }).catch(function(err) {
        res.set({'Content-Type': TEXT_HTML});
        res.end(errorToHTML(err), CHARSET);
    });
}

function onPostReceivedEmail(req, res) {
    return Promise.resolve().then(function() {
        log('onPostReceivedEmail ' + JSON.stringify(req.body));
        const form = {
            quietTime: 0,
            plainText: req.body.text || '',
        };
        const message = parseEmail(form.plainText);
        const subject = encodeURIComponent(subjectFromEmail(message) || 'message');
        const formId = '' + nextFormId++;
        openForms[formId] = form;
        res.redirect(SEE_OTHER, `/text-${formId}/${subject}.txt`);
        // redirects to onGetPlainText
    }).catch(function(err) {
        res.set({'Content-Type': TEXT_HTML});
        res.end(errorToHTML(err), CHARSET);
    });
}

function onGetPlainText(formId, req, res) {
    return requireForm(formId).then(function(form) {
        log('onGetPlainText ' + JSON.stringify(req.body));
        res.set({'Content-Type': TEXT_PLAIN});
        res.end(form.plainText, CHARSET);
    }).catch(function(err) {
        res.set({'Content-Type': TEXT_HTML});
        res.end(errorToHTML(err), CHARSET);
    });
}

function outputSubjects(argv) {
    const base = process.cwd();
    process.chdir(argv[3]);
    for (var a = 4; a < argv.length; ++a) {
        var message = fs.readFileSync(path.resolve(base, argv[a]), ENCODING);
        process.stdout.write(subjectFromMessage(parseMessage(message)) + EOL);
    }
}

function unbracket_data(data) {
    var match = /]\s*$/.exec(data);
    if (match) {
        // Remove the enclosing brackets and trailing white space:
        data = data.substring(1, data.length - match[0].length);
        if (data.length <= 1 || data.charAt(data.length - 1) != "`") {
            // data is complete
            if (data.substring(data.length - 2) == "]]") {
                data = data.substring(0, data.length - 2);
            }
            // Un-escape the brackets within data:
            return data.replace(/`]/g, "]");
        }
    }
    return null; // The field value continues on the next line.
}

function toShortName(fieldName) {
    if (fieldName != null) {
        var f = fieldName.lastIndexOf('.');
        if (f >= 0) {
            fieldName = fieldName.substring(0, f + 1);
        }
    }
    return fieldName;
}

/** Parse an email message. Don't check to see if it contains form data. */
function parseEmail(message) {
    var result = {headers: {}, fields: {}};
    var fields = result.headers;
    var fieldName = null;
    var fieldValue = "";
    message.split(/\r?\n/).every(function(line) {
        if (!line) { // A blank line separates the headers from the body.
            fields = result.fields;
            return true; // continue parsing
        }
        if (fieldName == null) {
            switch(line.charAt(0)) {
            case '!':
                fields = result.fields; // this isn't an email header
                if (line == '!/ADDON!') return false; // ignore subsequent lines
                if (!result.addonName) result.addonName = line.match(/^!([^!]*)/)[1];
                break;
            case '#':
                fields = result.fields; // this isn't an email header
                var found = /^#\s*(T|FORMFILENAME):(.*)/.exec(line);
                if (found) {
                    result.formType = found[2].trim();
                }
                var found = /^#\s*(V|VERSION):(.*)/.exec(line);
                if (found) {
                    result.addonVersion = found[2].trim();
                }
                break;
            default:
                if (fields === result.headers) {
                    var found = /^(\S+)\s*:\s*/.exec(line);
                    if (found) {
                        fieldName = found[1];
                        line = line.substring(found[0].length);
                    }
                } else {
                    var found = /:\s*\[/.exec(line);
                    if (found) {
                        fieldName = line.substring(0, found.index);
                        line = line.substring(found.index + found[0].length - 1);
                    }
                }
            }
        }
        if (fieldName != null) {
            fieldValue += line;
            if (fields === result.headers) {
                fields[fieldName.toLowerCase()] = fieldValue;
                fieldName = null;
                fieldValue = "";
            } else {
                var value = unbracket_data(fieldValue);
                if (value != null) {
                    // Field is complete on this line
                    fields[toShortName(fieldName)] = value;
                    fieldName = null;
                    fieldValue = "";
                }
            }
        }
        return true; // continue parsing
    });
    // log('parseEmail(' + JSON.stringify(message) + ') = ' + JSON.stringify(result));
    return result;
}

function messageContainsAForm(message, environment) {
    return (message && message.formType) || (environment && environment.ADDON_MSG_TYPE);
}

function parseMessage(email, environment) {
    var result = parseEmail(email);
    if (!messageContainsAForm(result, environment)) {
        throw "I don't know what form to display, since the message doesn't"
            + ' contain a line that starts with "#T:" or "#FORMFILENAME:".\n'
            + 'message: ' + JSON.stringify(email) + '\n';
    }
    return result;
}

function getMetaContents(html) {
    var values = {};
    // For example: <meta name="pack-it-forms-subject-suffix" content="_ICS213_{{field:10.subject}}">
    var pattern = /<\s*meta\b[^>]*\sname\s*=\s*"([^">]*)[^>]*>/gi;
    var name;
    while (name = pattern.exec(html)) {
        var content = /\scontent\s*=\s*"([^"]*)"/i.exec(name[0]);
        if (content) {
            values[htmlEntities.decode(name[1])] = htmlEntities.decode(content[1]);
        }
    }
    return values;
}

function expandTemplate(template, fields) {
    return template.replace(/\{\{field:([^\}]*)\}\}/g, function(found, fieldName) {
        return fields[toShortName(fieldName)] || '';
    });
}

function subjectFromMessage(parsed) {
    const fields = parsed.fields;
    fields['5.'] = fields['5.'] ? fields['5.'].charAt(0) : 'R';
    const formFile = fs.readFileSync(path.join(PackItForms, parsed.formType), ENCODING);
    const meta = getMetaContents(formFile);
    const prefix = meta['pack-it-forms-subject-prefix'] || '{{field:MsgNo}}_{{field:5.handling}}';
    const suffix = meta['pack-it-forms-subject-suffix'] || '_{{field:10.subject}}';
    return expandTemplate(prefix + suffix, fields).replace(/[^ -~]/g, function(found) {
        return '~';
    });
}

function copyHeaders(from) {
    if (!from) return from;
    var into = {};
    for (name in from) {
        if (name && name != 'content-length' && name != 'connection') {
            into[name] = from[name];
        }
    }
    return into;
}

function getAddonForms() {
    var addonForms = [];
    function nextAddon(chain, addonName) {
        return chain.then(function() {
            return fsp.readFile(path.join('addons', addonName + '.launch'), {encoding: ENCODING});
        }).then(function(data) {
            data.split(/[\r\n]+/).forEach(function(line) {
                if (line.startsWith('ADDON ')) {
                    var addonForm = {};
                    var name = null;
                    var value = '';
                    line.split(/\s+/).forEach(function(token) {
                        switch(token) {
                        case '-fn':
                        case '-a':
                        case '-t':
                            if (name) {
                                addonForm[name] = value;
                            }
                            name = token.substring(1);
                            value = '';
                            break;
                        default:
                            value += (value && ' ') + token;
                            break;
                        }
                    });
                    if (name) {
                        addonForm[name] = value;
                    }
                    addonForms.push(addonForm);
                }
            });
            return addonForms;
        });
    }
    return getAddonNames().then(function(addonNames) {
        return addonNames.reduce(nextAddon, Promise.resolve(addonForms));
    });
}

function errorToHTML(err, state) {
    const errMessage = errorToMessage(err);
    log('Error: ' + errMessage + (state ? JSON.stringify(state) : ''));
    var message = 'This information might help resolve the problem:<br/><br/>' + EOL
        + encodeHTML(errMessage).replace(/\r?\n/g, '<br/>' + EOL) + '<br/>' + EOL;
    if (state) {
        var stateString = JSON.stringify(state);
        if (stateString.startsWith('{')) {
            // Enable line wrapping:
            stateString = stateString.replace(/([^\\])","/g, '$1", "');
        }
        message += encodeHTML(stateString) + '<br/>' + EOL;
    }
    if (logFileName) {
        message += encodeHTML('log file ' + logFileName) + '<br/>' + EOL;
    }
    return PROBLEM_HEADER + message + '</body></html>';
}

function deleteOldFiles(directoryName, fileNamePattern, ageLimitMs) {
    return fsp.readdir(directoryName).then(function(fileNames) {
        const deadline = (new Date()).getTime() - ageLimitMs;
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
}

/** Redirect standard output into log files. */
function logToFile(fileNameSuffix) {
    const file = toWindowsEOL(logFilesWriter(fileNameSuffix));
    process.stdout.write = process.stderr.write = file.write.bind(file);
}

/** Store a copy of standard output into log files. */
function teeToFile(fileNameSuffix) {
    const file = logFilesWriter(fileNameSuffix);
    const tee = toWindowsEOL(teeToWritable(process.stdout, file));
    process.stdout.write = process.stderr.write = tee.write.bind(tee);
}

function teeToWritable(std, writable) {
    const stdWrite = std.write.bind(std);
    const reportError = function reportError(err) {
        if (err) {
            stdWrite(toLogMessage(err) + EOL, ENCODING);
        }
    };
    return new stream.Writable({
        decodeStrings: false,
        write: function(chunk, encoding, next) {
            if (encoding == 'buffer') {
                writable.write(chunk, reportError);
                return stdWrite(chunk, next);
            } else {
                writable.write(chunk, encoding, reportError);
                return stdWrite(chunk, encoding, next);
            }
        }
    });
}

/** Transform line endings from Unix style to Windows style. */
function toWindowsEOL(writable) {
    var previous = null;
    const insertCR = function insertCR(s) {
        return s.replace(/\n/g, function(LF, index) {
            if (index > 0) {
                previous = s.charAt(index - 1);
            }
            return (previous == '\r') ? LF : EOL;
        });
    };
    const transform = new stream.Transform({
        transform: function(chunk, encoding, output) {
            if (encoding == 'buffer') {
                output(null, new Buffer(insertCR(chunk.toString('binary')), 'binary'));
            } else if (typeof chunk == 'string') {
                output(null, insertCR(chunk))
            } else {
                output(null, chunk); // no change to an object
            }
        }
    });
    transform.pipe(writable);
    return transform;
}

/** @return a Writable that stores output in date-stamped files. */
function logFilesWriter(fileNameSuffix) {
    var fileStream = null;
    var fileName = null;
    var nextDay = 0;
    return new stream.Writable(
        {decodeStrings: false,
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
                     logFileName = path.resolve(fileName);
                     deleteOldFiles(LOG_FOLDER, /\.log$/, 7 * 24 * hours);
                 }
             }
             if (encoding == 'buffer') {
                 return fileStream.write(chunk, next);
             } else {
                 return fileStream.write(chunk, encoding, next);
             }
         }});
}

function encodeHTML(text) {
    return htmlEntities.encode(text + '');
}
