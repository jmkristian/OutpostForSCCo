/* Copyright 2018, 2019, 2020 by John Kristian

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
const child_process = require('child_process');
const fs = require('fs');
const makeTemp = require('tmp');
const path = require('path');

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

const commands = require('./commands');
const etc = require('./etc');
const server = require('./server');

const argvSlice = commands.argvSlice;
const ENCODING = etc.ENCODING;
const EOL = etc.EOL;
const enquoteRegex = etc.enquoteRegex;
const expandVariablesInFile = etc.expandVariablesInFile;
const fsp = etc.fsp;
const getAddonNames = server.getAddonNames;
const log = etc.log;
const LOG_FOLDER = etc.LOG_FOLDER;
const PackItMsgs = server.PackItMsgs;
const parseArgs = server.parseArgs;
const parseMessage = server.parseMessage;
const subjectFromMessage = server.subjectFromMessage;

const SEQUENCE_MARK = '^'; // must be OK in a file name, and come after '.' in lexical order
const SEQUENCE_REGEX = /\^/g; // matches all occurrences of SEQUENCE_MARK
const WEB_TO_PDF = path.join('bin', 'WebToPDF.exe');

if (process.argv.length > 2) {
    // With no arguments, do nothing quietly.
    etc.runCommand({
        'install': install,
        'uninstall': uninstall,
        'convert': convertMessageToFiles,
        'open': commands.browseMessage,
        'dry-run': commands.browseMessage,
        'serve': server.serve,
        'stop': commands.stopServers,
        'subject': outputSubjects
    });
}

/** Edit various files depending on how this program was installed. */
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
        log('not found: ' + cmdConvertFile);
    });
}

function installConfigFiles(myDirectory, addonNames, cmdConvert) {
    const launch = process.argv[3] + ' ' + path.join(myDirectory, 'bin', 'launch.vbs');
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

function convertMessageToFiles() {
    process.chdir(process.argv[4]);
    var args = argvSlice(5);
    const environment = parseArgs(args);
    var message_status = environment.message_status;
    if (!message_status) {
        if (environment.MSG_STATE) {
            message_status = environment.MSG_STATE.toLowerCase();
        } else if (environment.MSG_DATETIME_OP_RCVD) {
            message_status = 'unread';
        } else {
            message_status = 'sent';
        }
        args.push('--message_status'); args.push(message_status);
    }
    const spoolFilePrefix = subjectFromMessage(parseMessage(
        fs.readFileSync(path.resolve(PackItMsgs, environment.MSG_FILENAME), ENCODING)
    )).replace(/[<>:"/\\|?*]/g, '~').replace(SEQUENCE_REGEX, '~');

    const spoolDir = environment.SPOOL_DIR;
    if (spoolDir == null) throw new Error('no SPOOL_DIR in arguments.');
    var copyNames = environment.COPY_NAMES;
    if (copyNames == null) throw new Error('no COPY_NAMES in arguments.');
    copyNames = copyNames.replace(/\\./g, function(found) {
        const c = found.substring(1, 2);
        return (c == 'n') ? '\n' : c;
    });
    copyNames = copyNames.split('\n');
    return openMessage(args).then(function convertPage(pageURL) {
        if (!pageURL) {
            throw 'page URL = ' + JSON.stringify(pageURL);
        }
        return convertPageToFiles(environment.addon_name, pageURL, copyNames);
    }).then(function(tempFileNames) {
        return spoolFiles(tempFileNames, spoolDir, spoolFilePrefix);
    });
}

function convertPageToFiles(addon_name, pageURL, copyNames) {
    const fileNames = [];
    var args = ['bin', pageURL];
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

/** Output the subject of the message in a given file. */
function outputSubjects() {
    const argv = process.argv;
    const base = process.cwd();
    process.chdir(argv[3]);
    for (var a = 4; a < argv.length; ++a) {
        var message = fs.readFileSync(path.resolve(base, argv[a]), ENCODING);
        process.stdout.write(subjectFromMessage(parseMessage(message)) + EOL);
    }
}
