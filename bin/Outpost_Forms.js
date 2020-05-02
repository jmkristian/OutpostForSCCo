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
const http = require('http');
const makeTemp = require('tmp');
const morgan = require('morgan');
const path = require('path');
const querystring = require('querystring');
const stream = require('stream');
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

function promiseExecFile(program, args) {
    return new Promise(function execFile(resolve, reject) {
        try {
            child_process.execFile(
                program, args,
                function(err, stdout, stderr) {
                    try {
                        if (err) reject(err);
                        else resolve(stdout.toString(ENCODING) + stderr.toString(ENCODING));
                    } catch(err) {
                        reject(err);
                    }
                });
        } catch(err) {
            reject(err);
        }
    });
}

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
const ENCODING = CHARSET; // for files
const EOL = '\r\n';
const htmlEntities = new AllHtmlEntities();
const INI = { // patterns that match lines from a .ini file.
    comment: /^\s*;/,
    section: /^\s*\[\s*([^\]]*)\s*\]\s*$/,
    property: /^\s*([\w\.\-\_]+)\s*=(.*)$/
};
const JSON_TYPE = 'application/json';
const LOCALHOST = '127.0.0.1';
const LOG_FOLDER = 'logs';
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
const SETTINGS_FILE = path.join('bin', 'server.ini');
const StopServer = '/stopSCCoPIFO';
const SUBMIT_TIMEOUT_SEC = 30;
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
        method: 'POST',
        path: '/TBD'
    }
};
var settings = DEFAULT_SETTINGS;

if (process.argv.length > 2) {
    // With no arguments, do nothing quietly.
    const verb = process.argv[2];
    ((['build', 'convert', 'serve', 'subject', 'uninstall'].indexOf(verb) >= 0)
     ? Promise.resolve()
     : fsp.checkFolder(LOG_FOLDER).then(function() {logToFile(verb);})
    ).then(function() {
        switch(verb) {
        case 'build':
            // Customize various files for a given add-on.
            // This happens before creating an installer.
            return build();
        case 'install':
            // Edit various files depending on how this program was installed.
            return install();
        case 'uninstall':
            // Remove this add-on from Outpost's configuration.
            return uninstall();
        case 'convert':
            return convertMessageToFiles();
        case 'open':
        case 'dry-run':
            // Make sure a server is running, and then send process.argv[4..] to it.
            return browseMessage();
        case 'serve':
            // Serve HTTP requests until a few minutes after there are no forms open.
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
        expandVariablesInFile({addon_name: addonName},
                              path.join('bin', 'manual.html'),
                              path.join('built', 'manual.html'))
    ].concat(
        ['browse.cmd', 'launch-v.cmd', 'launch.vbs', 'UserGuide.html'].map(function(fileName) {
            return expandVariablesInFile({PROGRAM_PATH: programPath, DisplayName: displayName},
                                         fileName, path.join('built', fileName));
        })
    ));
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

function convertMessageToFiles() {
    process.chdir(process.argv[4]);
    var allArgs = argvSlice(5);
    var args = [];
    var spoolDir = null;
    var copyNames = null;
    var addon_name = null;
    var message_status = null;
    var msgDateTimeOpRcvd = null;
    for (var a = 0; a < allArgs.length; ++a) {
        var arg = allArgs[a];
        if (arg == '--COPY_NAMES') {
            copyNames = allArgs[++a];
            if (copyNames == '{{COPY_NAMES}}') copyNames = '';
        } else if (arg == '--SPOOL_DIR') {
            spoolDir = allArgs[++a];
        } else if (arg == '--message_status') {
            message_status = allArgs[++a];
            if (message_status == '{{MSG_STATE}}') message_status = '';
        } else {
            if (arg == '--addon_name') {
                addon_name = allArgs[a+1];
            } else if (arg == '--MSG_DATETIME_OP_RCVD') {
                msgDateTimeOpRcvd = allArgs[a+1];
            }
            args.push(arg);
        }
    }
    if (message_status) {
        message_status = message_status.toLowerCase();
    } else if (msgDateTimeOpRcvd) {
        message_status = 'unread';
    } else {
        message_status = 'sent';
    }
    args.push('--message_status'); args.push(message_status);
    return Promise.resolve().then(function() {
        if (spoolDir == null) throw new Error('no SPOOL_DIR in arguments.');
        if (copyNames == null) throw new Error('no COPY_NAMES in arguments.');
        copyNames = copyNames.replace(/\\./g, function(found) {
            const c = found.substring(1, 2);
            return (c == 'n') ? '\n' : c;
        });
        copyNames = copyNames.split('\n');
    }).then(function() {
        return openMessage(args);
    }).then(function convertPage(pageURL) {
        if (pageURL) {
            return convertPageToFiles(addon_name, pageURL, spoolDir, copyNames);
        } else {
            throw 'page URL = ' + JSON.stringify(pageURL);
        }
    });
}

function convertPageToFiles(addon_name, pageURL, spoolDir, copyNames) {
    const fileNames = [];
    var args = ['bin', pageURL];
    return copyNames.reduce(
        function(chain, copyName) {
            return chain.then(function() {
                return promiseTempFile({
                    dir: spoolDir,
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
    });
}

function browseMessage() {
    const args = argvSlice(4);
    return openMessage(args).then(function displayPage(pageURL) {
        if (pageURL) {
            startProcess('start', [pageURL], {shell: true, detached: true, stdio: 'ignore'});
        }
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
    app.get('/ping-:formId', function(req, res, next) {
        keepAlive(req.params.formId);
        res.statusCode = NOT_FOUND;
        noCache(res);
        res.end(); // with no body. The client ignores this response.
    });
    app.use(morgan('[:date[iso]] :method :url :status :res[content-length] - :response-time'));
    app.use(bodyParser.json({type: JSON_TYPE}));
    app.use(bodyParser.urlencoded({extended: false}));
    app.post(OpenOutpostMessage, function(req, res, next) {
        const args = req.body; // an array, thanks to bodyParser.json
        if (!args || !args.length) { // a dry run
            res.end();
        } else {
            formId = '' + nextFormId++;
            onOpen(
                formId, args
            ).then(function() {
                res.redirect(SEE_OTHER, 'http://' + LOCALHOST + ':' + myServerPort + '/form-' + formId);
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
    app.get('/form-:formId', function(req, res, next) {
        onGetForm(req.params.formId, req, res);
    });
    app.get('/message-:formId/:subject', function(req, res, next) {
        onGetMessage(req.params.formId, req, res);
    });
    app.post('/save-:formId', function(req, res, next) {
        onSaveMessage(req.params.formId, req);
        res.end();
    });
    app.post('/email-:formId', function(req, res, next) {
        onEmail(req.params.formId, req.body.formtext, res);
    });
    app.post('/submit-:formId', function(req, res, next) {
        onSubmit(req.params.formId, req.body, res,
                 `http://${req.get('host')}/fromOutpost-${req.params.formId}`);
    });
    app.get('/fromOutpost-:formId', function(req, res, next) {
        var form = openForms[req.params.formId];
        res.set(form.fromOutpost.headers);
        res.end(form.fromOutpost.body);
    });
    app.get('/msgs/:msgno', function(req, res, next) {
        // The client may not get the message this way,
        // since the server doesn't know what the formId is.
        res.statusCode = NOT_FOUND;
        res.end(); // with no body
    });
    app.post(StopServer, function(req, res, next) {
        res.end(); // with no body
        log(StopServer);
        exitSoon();
    });
    app.get('/manual', function(req, res, next) {
        onGetManual(res);
    });
    app.post('/manual-create', function(req, res, next) {
        const formId = '' + nextFormId++;
        Promise.resolve().then(function() {
            const form = req.body.form;
            const space = form.indexOf(' ');
            return onOpen(formId, [
                '--message_status', 'manual',
                '--addon_name', form.substring(0, space),
                '--ADDON_MSG_TYPE', form.substring(space + 1),
                '--operator_call_sign', req.body.operator_call_sign || '',
                '--operator_name', req.body.operator_name || '']);
        }).then(function() {
            res.redirect('/form-' + formId);
        }, function openFailed(err) {
            res.set({'Content-Type': TEXT_HTML});
            res.end(errorToHTML(err, JSON.stringify(req.body)), CHARSET);
        });
    });
    app.post('/manual-view', function(req, res, next) {
        const formId = '' + nextFormId++;
        Promise.resolve().then(function() {
            var args = ['--message_status', 'unread', '--mode', 'readonly'];
            for (var name in req.body) {
                args.push('--' + name);
                args.push(req.body[name]);
            }
            if (req.body.OpDate && req.body.OpTime) {
                args.push('--MSG_DATETIME_OP_RCVD')
                args.push(req.body.OpDate + " " + req.body.OpTime)
            }
            return onOpen(formId, args);
        }).then(function() {
            res.redirect('/form-' + formId);
        }, function openFailed(err) {
            res.set({'Content-Type': TEXT_HTML});
            res.end(errorToHTML(err, JSON.stringify(req.body)), CHARSET);
        });
    });
    app.get('/pdf/\*.pdf', express.static('.', {setHeaders: function(res, path, stat) {
        res.set('Content-Type', 'application/pdf');
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
        for (var a = 0; a+1 < args.length; ++a) {
            if (args[a] == '--addon_name') {
                var addon_name = args[a+1];
                return fsp.stat(
                    path.join('addons', addon_name + '.ini')
                ).catch(function(err) {
                    throw new Error('This is not a server for ' + addon_name + '.');
                });
            }
        }
    }).then(function() {
        openForms[formId] = {
            args: args,
            quietTime: 0
        };
        log('/form-' + formId + ' opened');
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
        var form = openForms[formId]
        if (form != null) return form;
        const fileName = saveFileName(formId);
        return fsp.readFile(fileName, ENCODING).then(function(data) {
            form = JSON.parse(data);
            if (form) {
                form.quietTime = 0;
                openForms[formId] = form;
                log('Read ' + fileName);
            }
            return form;
        });
    }).catch(log);
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
        var option = args[i];
        if (option.startsWith('--')) {
            environment[option.substring(2)] = args[++i];
        }
    }
    if (environment.MSG_INDEX == '{{MSG_INDEX}}') {
        delete environment.MSG_INDEX;
    }
    if (['draft', 'ready'].indexOf(environment.message_status) >= 0
        && !environment.MSG_INDEX) {
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

function onGetMessage(formId, req, res) {
    var foundForm = null;
    return keepAlive(formId).then(function(form) {
        foundForm = form;
        noCache(res);
        if (form) {
            res.set({'Content-Type': TEXT_PLAIN});
            res.end('#Subject: ' + form.environment.subject + EOL + form.message, CHARSET);
        } else if (formId < nextFormId) {
            throw new Error('message ' + formId + ' was discarded, since it was closed.');
        } else {
            throw new Error('message ' + formId + ' has not been opened.');
        }
    }).catch(function(err) {
        res.set({'Content-Type': TEXT_HTML});
        res.end(errorToHTML(err, foundForm), CHARSET);
    });
}

/** Handle an HTTP GET /form-id request. */
function onGetForm(formId, req, res) {
    var foundForm = null;
    return keepAlive(formId).then(function(form) {
        foundForm = form;
        noCache(res);
        res.set({'Content-Type': TEXT_HTML});
        if (formId <= 0) {
            throw 'Form numbers start with 1.';
        } else if (!form) {
            log('/form-' + formId + ' is not open');
            if (formId < nextFormId) {
                throw '/form-' + formId + ' was discarded, since it was submitted or closed.';
            } else {
                throw '/form-' + formId + ' has not been opened.';
            }
        } else {
            log('/form-' + formId + ' viewed');
            updateSettings();
            return loadForm(
                formId, form
            ).then(function() {
                if (form.environment.message_status == 'manual-created') {
                    return getManualMessage(formId, form);
                } else {
                    return getForm(form, res);
                }
            }).then(function(data) {
                res.end(data, CHARSET);
            });
        }
    }).catch(function(err) {
        res.end(errorToHTML(err, foundForm), CHARSET);
    });
}

function loadForm(formId, form) {
    if (!form.environment) {
        form.environment = parseArgs(form.args);
        form.environment.emailURL = '/email-' + formId;
        form.environment.submitURL = '/submit-' + formId;
    }
    if (form.environment.mode == 'readonly') {
        form.environment.pingURL = '/ping-' + formId;
    } else {
        form.environment.saveURL = '/save-' + formId;
    }
    if (form.message != null) {
        return Promise.resolve();
    }
    return getMessage(
        form.environment
    ).then(function(message) {
        form.message = message;
        if (message && !form.environment.ADDON_MSG_TYPE) {
            form.environment.ADDON_MSG_TYPE = parseMessage(message).formType;
        }
    });
}

function getForm(form, res) {
    log(form.environment);
    if (!form.environment.addon_name) {
        throw new Error('addon_name is ' + form.environment.addon_name + '\n');
    }
    var formType = form.environment.ADDON_MSG_TYPE;
    if (!formType) {
        throw "I don't know what form to display, since "
            + "I received " + JSON.stringify(formType)
            + " instead of the name of a form.\n";
    }
    if (['read', 'unread'].indexOf(form.environment.message_status) >= 0) {
        const receiverFileName = formType.replace(/\.([^.]*)$/, '.receiver.$1');
        if (fs.existsSync(path.join(PackItForms, receiverFileName))) {
            formType = receiverFileName;
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

function getManualMessage(formId, form) {
    const template = path.join('bin', 'message.html');
    return fsp.readFile(
        template, {encoding: ENCODING}
    ).then(function(data) {
        return expandVariables(data, {
            SUBJECT: encodeHTML(form.environment.subject),
            MESSAGE: encodeHTML(form.message),
            MESSAGE_URL: '/message-' + formId
                + '/' + encodeURIComponent(form.environment.subject)
        });
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
        return fsp.readFile(
            SETTINGS_FILE, {encoding: ENCODING}
        ).then(function(data) {
            settingsUpdatedTime = fileTime;
            var fileSettings = {};
            var section = null;
            data.split(/[\r\n]+/).forEach(function(line) {
                if (INI.comment.test(line)) {
                    return;
                } else if (INI.section.test(line)) {
                    var match = line.match(INI.section);
                    section = match[1];
                    if (fileSettings[section] == null) {
                        fileSettings[section] = {};
                    }
                } else if (INI.property.test(line)) {
                    var match = line.match(INI.property);
                    if (section) {
                        fileSettings[section][match[1]] = match[2];
                    } else {
                        fileSettings[match[1]] = match[2];
                    }
                };
            });
            if ((typeof fileSettings.Opdirect.port) == 'string') {
                fileSettings.Opdirect.port = parseInt(fileSettings.Opdirect.port);
            }
            newSettings = merge(DEFAULT_SETTINGS, fileSettings);
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

function onSaveMessage(formId, req) {
    return findForm(formId).then(function(form) {
        if (form) {
            var charset = CHARSET;
            const contentType = req.headers['content-type'];
            if (contentType) {
                const found = /; *charset=([^ ;]+)/i.exec(contentType);
                if (found) {
                    charset = found[1];
                }
            }
            req.pipe(concat_stream(function(buffer) {
                var message = buffer.toString(charset);
                log('/save-' + formId + ' ' + message.length);
                keepAlive(formId);
                form.message = message;
            }));
        } else {
            log('form ' + formId + ' not saved');
        }
    });
}

function onEmail(formId, message, res) {
    var foundForm = null;
    return keepAlive(formId).then(function(form) {
        foundForm = form;
        form.message = message;
        form.environment.emailing = true;
        form.environment.subject = subjectFromMessage(parseMessage(message));
        form.environment.mode = 'readonly';
        res.redirect('/form-' + formId);
    }).catch(function(err) {
        res.set({'Content-Type': TEXT_HTML});
        res.end(errorToHTML(err, foundForm), CHARSET);
    });
}

function onSubmit(formId, q, res, fromOutpostURL) {
    var foundForm = null;
    return keepAlive(formId).then(function(form) {
        foundForm = form;
        const message = q.formtext;
        const parsed = parseMessage(message);
        const fields = parsed.fields;
        const handling = fields['5.'] || '';
        form.environment.subject = subjectFromMessage(parsed);
        if (form.environment.message_status == 'manual') {
            form.environment.message_status = 'manual-created';
            form.message = message;
            return null;
        }
        // Outpost requires Windows-style line breaks:
        form.message = message.replace(/([^\r])\n/g, '$1' + EOL);
        const submission = {
            formId: formId,
            form: form,
            addonName: form.environment.addon_name,
            subject: form.environment.subject,
            urgent: (['IMMEDIATE', 'I'].indexOf(handling) >= 0)
        };
        return submitToOpdirect(submission, messageForOpdirect(submission));
    }).then(
        respondFromOpdirect
    ).then(function(fromOutpost) {
        if (fromOutpost) {
            res.set({'Content-Type': TEXT_HTML});
            foundForm.fromOutpost = fromOutpost;
            log(`/form-${formId} from Outpost ` + JSON.stringify(fromOutpost));
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
            log('/form-' + formId + ' submitted');
            foundForm.environment.mode = 'readonly';
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
        res.end(errorToHTML(err, foundForm && foundForm.environment), CHARSET);
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
        log(context + `from Outpost ${res.statusCode} ${data}`);
        // It's an old version of Outpost. Maybe Aoclient will work:
        return submitToAoclient(submission);
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
        const options = settings.Opdirect;
        // Send an HTTP request.
        log(context + 'to Outpost ' + JSON.stringify(options) + ' ' + body);
        const exchange = httpExchange(options);
        exchange.req.setHeader('Content-Type', 'application/x-www-form-urlencoded');
        exchange.req.setTimeout(SUBMIT_TIMEOUT_SEC * seconds);
        return httpPromise(exchange, body);
    }).catch(function(err) {
        if (err == 'req.timeout' || err == 'res.timeout') {
            throw "Outpost didn't respond within " + SUBMIT_TIMEOUT_SEC + ' seconds.';
        } else if ((err + '').indexOf(' ECONNREFUSED ') >= 0) {
            throw "Opdirect isn't running, it appears." + EOL + err;
        } else {
            throw err;
        }
    });
}

function submitToAoclient(submission) {
    const msgFileName = path.resolve(PackItMsgs, 'form-' + submission.formId + '.txt');
    // Remove the first line of the Outpost message header:
    const message = submission.form.message.replace(/^\s*![^\r\n]*[\r\n]+/, '')
    // Outpost will insert !submission.addonName!.
    return fsp.writeFile(
        msgFileName, message, {encoding: ENCODING}
    ).then(function() {
        return fsp.unlink(OpdFAIL).catch(function(){});
    }).then(function() {
        var options = ['-a', submission.addonName,
                       '-f', msgFileName,
                       '-s', submission.subject];
        if (submission.urgent) {
            options.push('-u');
        }
        const program = path.join ('addons', submission.addonName, 'Aoclient.exe');
        log('/form-' + submission.formId + ' to ' + program + ' ' + options.join(' '));
        return promiseExecFile(program, options);
    }).then(function(output) {
        return fsp.readFile(
            OpdFAIL, ENCODING
        ).then(function(data) {
            throw `${OpdFAIL} : ${data}\n\n${output}`;
        }, function readFileFailed(err) {
            fsp.unlink(msgFileName).then(function() {
                log("Deleted " + msgFileName);
            });
            return null; // success
        });
    });
}

/** Handle an HTTP GET /manual request. */
function onGetManual(res) {
    keepAlive(0);
    res.set({'Content-Type': TEXT_HTML});
    const template = path.join('bin', 'manual.html');
    return fsp.readFile(
        template, {encoding: ENCODING}
    ).then(function(data) {
        return getAddonForms().then(function(forms) {
            var form_options = forms
                .filter(function(form) {return !!(form.a && form.t);})
                .map(function(form) {
                    return EOL
                        + '<option value="'
                        + encodeHTML(form.a + ' ' + form.t)
                        + '">'
                        + encodeHTML(form.fn ? form.fn.replace(/_/g, ' ') : form.t)
                        + '</option>';
                });
            res.send(expandVariables(data, {form_options: form_options.join('')}));
        });
    }, function(err) {
        res.send(errorToHTML(err, template));
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

function parseMessage(message) {
    var result = {};
    var fields = {};
    var fieldName = null;
    var fieldValue = "";
    message.split(/[\r\n]+/).every(function(line) {
        if (!line) return true;
        var idx = 0;
        if (fieldName == null) {
            switch(line.charAt(0)) {
            case '!':
                if (line == '!/ADDON!') return false; // ignore subsequent lines
                break;
            case '#':
                var foundType = /^#\s*(T|FORMFILENAME):(.*)/.exec(line);
                if (foundType) {
                    result.formType = foundType[2].trim();
                }
                break;
            default:
                idx = line.indexOf(':');
                if (idx >= 0) {
                    fieldName = line.substring(0, idx);
                    while (++idx < line.length && line.charAt(idx) != '[');
                }
            }
        }
        if (fieldName != null) {
            fieldValue += line.substring(idx);
            var value = unbracket_data(fieldValue);
            if (value != null) {
                // Field is complete on this line
                fields[toShortName(fieldName)] = value;
                fieldName = null;
                fieldValue = "";
            }
        }
        return true;
    });
    if (!result.formType) {
        throw "I don't know what form to display, since the message doesn't"
            + ' contain a line that starts with "#T:" or "#FORMFILENAME:".\n';
    }
    result.fields = fields;
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
    var message = 'This information might help resolve the problem:<br/><br/>' + EOL
        + encodeHTML(errorToMessage(err)).replace(/\r?\n/g, '<br/>' + EOL) + '<br/>' + EOL;
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
                     logFileName = path.resolve(fileName);
                     deleteOldFiles(LOG_FOLDER, /\.log$/, 7 * 24 * hours);
                 }
             }
             return fileStream.write(chunk, encoding, next);
         }});
    windowsEOL.pipe(dailyFile);
    const writer = windowsEOL.write.bind(windowsEOL);
    process.stdout.write = process.stderr.write = writer;
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

function expandVariables(data, values) {
    for (var v in values) {
        data = data.replace(new RegExp(enquoteRegex('{{' + v + '}}'), 'g'), values[v]);
    }
    return data;
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

function log(data) {
    if (data) {
        var message = (typeof data == 'object') ? errorToMessage(data) : ('' + data);
        console.log('[' + new Date().toISOString() + '] ' + message);
    }
}

function encodeHTML(text) {
    return htmlEntities.encode(text + '');
}

function enquoteRegex(text) {
    // Crude but adequate:
    return ('' + text).replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}
