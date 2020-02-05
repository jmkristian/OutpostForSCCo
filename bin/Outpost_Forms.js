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
const morgan = require('morgan');
const path = require('path');
const querystring = require('querystring');
const stream = require('stream');

const CHARSET = 'utf-8'; // for HTTP
const ENCODING = CHARSET; // for files
const EOL = '\r\n';
const FORBIDDEN = 403;
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
const NOT_FOUND = 404;
const OpdFAIL = 'OpdFAIL';
const OpenOutpostMessage = '/openOutpostMessage';
const PackItForms = 'pack-it-forms';
const PackItMsgs = path.join(PackItForms, 'msgs');
const PortFileName = path.join(LOG_FOLDER, 'server-port.txt');
const PROBLEM_HEADER = '<html><head><title>Problem</title></head><body>'
      + EOL + '<h3><img src="/icon-warning.png" alt="warning"'
      + ' style="width:24pt;height:24pt;vertical-align:middle;margin-right:1em;">'
      + 'Something went wrong.</h3>';
const SAVE_FOLDER = 'saved';
const SETTINGS_FILE = path.join('bin', 'server.ini');
const StopServer = '/stopSCCoPIFO';
const SUBMIT_TIMEOUT_SEC = 30;
const TEXT_HTML = 'text/html; charset=' + CHARSET;
const TEXT_PLAIN = 'text/plain; charset=' + CHARSET;

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
    if (!(verb == 'serve' || verb == 'subject')) {
        logToFile(verb);
    }
    try {
        switch(verb) {
        case 'build':
            // Customize various files for a given add-on.
            // This happens before creating an installer.
            build(process.argv[3], process.argv[4], process.argv[5], process.argv[6]);
            break;
        case 'install':
            // Edit various files depending on how this program was installed.
            install();
            break;
        case 'uninstall':
            // Remove this add-on from Outpost's configuration.
            uninstall();
            break;
        case 'open':
        case 'dry-run':
            // Make sure a server is running, and then send process.argv[4..] to it.
            openMessage();
            break;
        case 'serve':
            // Serve HTTP requests until a few minutes after there are no forms open.
            serve();
            break;
        case 'stop':
            // Stop any running servers.
            stopServers(function() {});
            break;
        case 'subject':
            // Output the subject of the message in a given file.
            outputSubjects(process.argv);
            break;
        default:
            throw 'unknown verb "' + verb + '"';
        }
    } catch(err) {
        log(err);
        process.exit(1);
    }
}

function build(addonVersion, addonName, programPath, displayName) {
    expandVariablesInFile({addon_version: addonVersion, addon_name: addonName, PROGRAM_PATH: programPath},
                          path.join('bin', 'addon.ini'),
                          path.join('built', 'addons', addonName + '.ini'));
    expandVariablesInFile({addon_name: addonName},
                          path.join('bin', 'Aoclient.ini'),
                          path.join('built', 'addons', addonName, 'Aoclient.ini'));
    expandVariablesInFile({addon_name: addonName},
                          path.join('bin', 'manual.html'),
                          path.join('built', 'manual.html'));
    ['browse.cmd', 'launch-v.cmd', 'launch.vbs', 'UserGuide.html'].forEach(function(fileName) {
        expandVariablesInFile({PROGRAM_PATH: programPath, DisplayName: displayName},
                              fileName, path.join('built', fileName));
    });
}

function install() {
    // This method must be idempotent, in part because Avira antivirus
    // might execute it repeatedly while scrutinizing the .exe for viruses.
    const myDirectory = process.cwd();
    const addonNames = getAddonNames();
    log('addons ' + JSON.stringify(addonNames));
    installConfigFiles(myDirectory, addonNames);
    installIncludes(myDirectory, addonNames);
    fs.stat(LOG_FOLDER, function(err, stats) {
        if (err || !stats) {
            fs.mkdir(LOG_FOLDER, function(err){});
        }
    });
    fs.stat(SAVE_FOLDER, function(err, stats) {
        if (err || !stats) {
            fs.mkdir(SAVE_FOLDER, function(err){});
        }
    });
}

function installConfigFiles(myDirectory, addonNames) {
    var launch = process.argv[3] + ' ' + path.join(myDirectory, 'bin', 'launch.vbs');
    expandVariablesInFile({INSTDIR: myDirectory, LAUNCH: launch}, 'UserGuide.html');
    addonNames.forEach(function(addon_name) {
        expandVariablesInFile({INSTDIR: myDirectory, LAUNCH: launch},
                              path.join('addons', addon_name + '.ini'));
    });
}

/* Make sure Outpost's Launch.ini or Launch.local file includes addons/*.launch. */
function installIncludes(myDirectory, addonNames) {
    const oldInclude = new RegExp('^INCLUDE[ \\t]+' + enquoteRegex(myDirectory) + '[\\\\/]', 'i');
    var myIncludes = addonNames.map(function(addonName) {
        return 'INCLUDE ' + path.resolve(myDirectory, 'addons', addonName + '.launch');
    });
    // Each of the process arguments names a directory that contains Outpost configuration data.
    for (var a = 4; a < process.argv.length; a++) {
        var outpostLaunch = path.resolve(process.argv[a], 'Launch.local');
        var launchIni = path.resolve(process.argv[a], 'Launch.ini');
        if (fs.readFileSync(launchIni, ENCODING).split(/[\r\n]+/).some(function(line) {
            return oldInclude.test(line);
        })) {
            log('already included into ' + launchIni);
            removeIncludes(addonNames, outpostLaunch);
            continue;
        }
        // Upsert myIncludes into outpostLaunch:
        if (!fs.existsSync(outpostLaunch)) {
            // Work around a bug: Outpost might ignore the first line of Launch.local.
            var data = EOL + myIncludes.join(EOL) + EOL;
            fs.writeFile(outpostLaunch, data, {encoding: ENCODING}, function(err) {
                log(err ? err : 'included into ' + outpostLaunch);
            });
        } else {
            fs.readFile(outpostLaunch, ENCODING, function(err, data) {
                if (err) {
                    log(err); // tolerable
                } else {
                    var oldLines = data.split(/[\r\n]+/);
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
                    // Work around a bug: Outpost might ignore the first line of Launch.local.
                    var newData = EOL + newLines.join(EOL) + EOL;
                    if (newData == data) {
                        log('already included into ' + outpostLaunch);
                    } else {
                        fs.writeFile(outpostLaunch, newData, {encoding: ENCODING}, function(err) {
                            log(err ? err : ('included into ' + outpostLaunch));
                        }); 
                    }
                }
            });
        }
    }
}

function uninstall() {
    stopServers(function() {
        const addonNames = getAddonNames();
        log('addons ' + JSON.stringify(addonNames));
        for (a = 3; a < process.argv.length; a++) {
            removeIncludes(addonNames, path.resolve(process.argv[a], 'Launch.local'));
        }
    });
}

function removeIncludes(addonNames, outpostLaunch) {
    if (fs.existsSync(outpostLaunch)) {
        // Remove INCLUDEs from outpostLaunch:
        fs.readFile(outpostLaunch, ENCODING, function(err, data) {
            if (err) {
                log(err);
            } else {
                var newData = data;
                addonNames.forEach(function(addonName) {
                    var myLaunch = enquoteRegex(path.resolve(process.cwd(), 'addons', addonName + '.launch'));
                    var myInclude1 = new RegExp('^INCLUDE[ \\t]+' + myLaunch + '[\r\n]*', 'i');
                    var myInclude = new RegExp('[\r\n]+INCLUDE[ \\t]+' + myLaunch + '[\r\n]+', 'gi');
                    newData = newData.replace(myInclude1, '').replace(myInclude, EOL);
                });
                if (newData != data) {
                    fs.writeFile(outpostLaunch, newData, {encoding: ENCODING}, function(err) {
                        log(err ? err : ('removed ' + JSON.stringify(addonNames) + ' from ' + outpostLaunch));
                    });
                }
            }
        });
    }
}

/** Return a list of names, such that for each name there exists a <name>.launch file in the given directory. */
function getAddonNames(directoryName) {
    var addonNames = [];
    const fileNames = fs.readdirSync(directoryName || 'addons', {encoding: ENCODING});
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
}

function openMessage() {
    const programPath = process.argv[3];
    var args = [];
    for (var i = 4; i < process.argv.length; i++) {
        args.push(process.argv[i]);
    }
    var retries = 0;
    function tryNow() {
        try {
            openForm(args, tryLater);
        } catch(err) {
            tryLater(err);
        }
    }
    function tryLater(err) {
        log(err);
        if (retries >= 6) {
            log(retries + ' retries failed ' + JSON.stringify(args));
            logAndAbort('Goodbye.');
        } else {
            ++retries;
            log('retries = ' + retries);
            if (retries == 1 || retries == 4) {
                startProcess(programPath, ['serve'], {detached: true, stdio: 'ignore'});
            }
            setTimeout(tryNow, retries * seconds);
        }
    }
    tryNow();
}

function openForm(args, tryLater) {
    if (!fs.existsSync(PortFileName)) {
        // There's definitely no server running. Start one now:
        throw PortFileName + " doesn't exist";
    }
    var options = {host: LOCALHOST,
                   port: parseInt(fs.readFileSync(PortFileName, ENCODING), 10),
                   method: 'POST',
                   path: OpenOutpostMessage,
                   headers: {'Content-Type': JSON_TYPE + '; charset=' + CHARSET}};
    var postData = JSON.stringify(args);
    log('http://' + options.host + ':' + options.port
        + ' ' + options.method + ' ' + OpenOutpostMessage + ' ' + postData);
    request(options, function(err, data) {
        if (err) {
            tryLater(err);
        } else {
            data = data && data.trim();
            log('opened form ' + data);
            if (data) {
                startProcess('start', [data], {shell: true, detached: true, stdio: 'ignore'});
            }
            process.exit(0); // mission accomplished
        }
    }).end(postData, CHARSET);
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

function stopServers(next) {
    try {
        // Find the port numbers of all servers (including stopped servers):
        var ports = [];
        const fileNames = fs.readdirSync(LOG_FOLDER, {encoding: ENCODING});
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
        try {
            fs.unlink(PortFileName, log);
        } catch(err) {
            log(err); // harmless
        }
        var forked = ports.length;
        ports.forEach(function(port) {
            const join = function join(err) {
                log(err || ('stopped server on port ' + port));
                if (--forked == 0) {
                    next();
                }
            };
            try {
                log('stopping server on port ' + port);
                request({host: LOCALHOST,
                         port: parseInt(port, 10),
                         method: 'POST',
                         path: StopServer},
                        join).end();
            } catch(err) {
                join(err);
            }
        });
    } catch(err) {
        log(err);
        next();
    }
}

function request(options, callback) {
    const onError = function(event) {
        return function(err) {
            (callback || log)(err || event);
        }
    }
    var req = http.request(options, function(res) {
        res.on('aborted', onError('res.aborted'));
        res.on('error', onError('res.error'));
        res.on('timeout', onError('res.timeout'));
        res.pipe(concat_stream(function(buffer) {
            var data = buffer.toString(CHARSET);
            if (callback) {
                callback(null, data, res);
            }
        }));
    });
    req.on('aborted', onError('req.aborted'));
    req.on('error', onError('req.error'));
    req.on('timeout', onError('req.timeout'));
    return req;
}

var openForms = {'0': {quietTime: 0}}; // all the forms that are currently open
// Form 0 is a hack to make sure the server doesn't shut down immediately after starting.
var nextFormId = 1; // Forms are assigned sequence numbers when they're opened.

function serve() {
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
        // req.body is an array, thanks to bodyParser.json
        var result = '';
        const args = req.body;
        if (args && args.length > 0) {
            formId = '' + nextFormId++;
            try {
                onOpen(formId, args);
                res.set({'Content-Type': TEXT_PLAIN});
                result = 'http://' + LOCALHOST + ':' + myServerPort + '/form-' + formId;
            } catch(err) {
                log(err);
                req.socket.end(); // abort the HTTP connection
                // The client will log "Error: socket hang up" into logs/*-open.log,
                // and start another server. It would be better for the client to
                // log something more informative, but client versions <= 2.18
                // can't be induced to do that.
                res.writeHead(421, {});
            }
        }
        res.end(result, CHARSET);
    });
    app.get('/form-:formId', function(req, res, next) {
        keepAlive(req.params.formId);
        onGetForm(req.params.formId, req, res);
    });
    app.get('/message-:formId/:subject', function(req, res, next) {
        keepAlive(req.params.formId);
        onGetMessage(req.params.formId, req, res);
    });
    app.post('/save-:formId', function(req, res, next) {
        onSaveMessage(req.params.formId, req);
        res.end();
    });
    app.post('/email-:formId', function(req, res, next) {
        keepAlive(req.params.formId);
        onEmail(req.params.formId, req.body.formtext, res);
    });
    app.post('/submit-:formId', function(req, res, next) {
        keepAlive(req.params.formId);
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
        process.exit(0);
    });
    app.get('/manual', function(req, res, next) {
        onGetManual(res);
    });
    app.post('/manual-create', function(req, res, next) {
        try {
            const formId = '' + nextFormId++;
            const form = req.body.form;
            const space = form.indexOf(' ');
            onOpen(formId, ['--message_status', 'manual',
                            '--addon_name', form.substring(0, space),
                            '--ADDON_MSG_TYPE', form.substring(space + 1),
                            '--operator_call_sign', req.body.operator_call_sign || '',
                            '--operator_name', req.body.operator_name || '']);
            res.redirect('/form-' + formId);
        } catch(err) {
            res.set({'Content-Type': TEXT_HTML});
            res.end(errorToHTML(err, JSON.stringify(req.body)), CHARSET);
        }
    });
    app.post('/manual-view', function(req, res, next) {
        try {
            var args = ['--message_status', 'unread', '--mode', 'readonly'];
            for (var name in req.body) {
                args.push('--' + name);
                args.push(req.body[name]);
            }
            if (req.body.OpDate && req.body.OpTime) {
                args.push('--MSG_DATETIME_OP_RCVD')
                args.push(req.body.OpDate + " " + req.body.OpTime)
            }
            const formId = '' + nextFormId++;
            onOpen(formId, args);
            res.redirect('/form-' + formId);
        } catch(err) {
            res.set({'Content-Type': TEXT_HTML});
            res.end(errorToHTML(err, JSON.stringify(req.body)), CHARSET);
        }
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

    const server = app.listen(0);
    const address = server.address();
    myServerPort = address.port;
    if (!fs.existsSync(LOG_FOLDER)) {
        fs.mkdirSync(LOG_FOLDER);
    }
    logToFile('server-' + myServerPort);
    log('Listening for HTTP requests on port ' + myServerPort + '...');
    fs.writeFileSync(PortFileName, myServerPort + '', {encoding: ENCODING}); // advertise my port
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
                        server.close();
                        process.exit(0);
                    });
                } else {
                    fs.readFile(PortFileName, {encoding: ENCODING}, function(err, data) {
                        if (err || (data && (data.trim() != (myServerPort + '')))) {
                            log(PortFileName + ' ' + (err ? err : data));
                            clearInterval(checkSilent);
                            deleteMySaveFiles();
                            server.close();
                            process.exit(0);
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
    for (var i = 0; i+1 < args.length; ++i) {
        if (args[i] == '--addon_name') {
            var addon_name = args[i+1];
            if (!fs.statSync(path.join('addons', addon_name + '.ini'))) {
                throw new Error('This is not a server for ' + addon_name + '.');
            }
            break;
        }
    }
    openForms[formId] = {
        args: args,
        quietTime: 0
    };
    log('/form-' + formId + ' opened');
}

function keepAlive(formId) {
    form = findForm(formId);
    if (form) {
        form.quietTime = 0;
    } else if (formId == "0") {
        openForms[formId] = {quietTime: 0};
    }
}

function findForm(formId) {
    var form = openForms[formId];
    if (form == null) {
        try {
            const fileName = saveFileName(formId);
            form = JSON.parse(fs.readFileSync(fileName, ENCODING));
            if (form) {
                form.quietTime = 0;
                openForms[formId] = form;
                log('Read ' + fileName);
            }
        } catch(err) {
            log(err);
        }
    }
    return form;
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
    var message = null;
    if (environment.message) {
        message = environment.message;
    } else if (environment.MSG_FILENAME) {
        const msgFileName = path.resolve(PackItMsgs, environment.MSG_FILENAME);
        message = fs.readFileSync(msgFileName, {encoding: ENCODING});
        fs.unlink(msgFileName, function(err) {
            log(err ? err : ("Deleted " + msgFileName));
        });
    }
    if (message) {
        // Outpost sometimes appends junk to the end of message.
        // One observed case was "You have new messages."
        message = message.replace(/[\r\n]+[ \t]*!\/ADDON![\s\S]*$/, EOL + '!/ADDON!' + EOL);
    }
    return message;
}

function onGetMessage(formId, req, res) {
    noCache(res);
    try {
        const form = findForm(formId);
        if (form) {
            res.set({'Content-Type': TEXT_PLAIN});
            res.end('#Subject: ' + form.environment.subject + EOL + form.message);
        } else if (formId < nextFormId) {
            throw new Error('message ' + formId + ' was discarded, since it was closed.');
        } else {
            throw new Error('message ' + formId + ' has not been opened.');
        }
    } catch(err) {
        res.set({'Content-Type': TEXT_HTML});
        res.end(errorToHTML(err, form), CHARSET);
    }
}

/** Handle an HTTP GET /form-id request. */
function onGetForm(formId, req, res) {
    noCache(res);
    res.set({'Content-Type': TEXT_PLAIN});
    const form = findForm(formId);
    if (formId <= 0) {
        res.status(400).end('Form numbers start with 1.', CHARSET);
    } else if (!form) {
        log('/form-' + formId + ' is not open');
        if (formId < nextFormId) {
            res.status(NOT_FOUND)
                .end('/form-' + formId + ' was discarded, since it was submitted or closed.',
                     CHARSET);
        } else {
            res.status(NOT_FOUND)
                .end('/form-' + formId + ' has not been opened.', CHARSET);
        }
    } else {
        log('/form-' + formId + ' viewed');
        try {
            res.set({'Content-Type': TEXT_HTML});
            updateSettings();
            loadForm(formId, form, req);
            if (form.environment.message_status == 'manual-created') {
                showManualMessage(formId, form, res);
            } else {
                showForm(form, res);
            }
        } catch(err) {
            res.end(errorToHTML(err, form), CHARSET);
        }
    }
}

function loadForm(formId, form, req) {
    if (!form.environment) {
        form.environment = parseArgs(form.args);
        form.environment.emailURL = '/email-' + formId;
        form.environment.submitURL = '/submit-' + formId;
    }
    if (form.message == null) {
        form.message = getMessage(form.environment);
        if (form.message) {
            if (!form.environment.ADDON_MSG_TYPE) {
                form.environment.ADDON_MSG_TYPE = parseMessage(form.message).formType;
            }
        }
    }
    if (form.environment.mode == 'readonly') {
        form.environment.pingURL = '/ping-' + formId;
    } else {
        form.environment.saveURL = '/save-' + formId;
    }
}

function showForm(form, res) {
    log(form.environment);
    if (!form.environment.addon_name) {
        throw new Error('addon_name is ' + form.environment.addon_name + '\n');
    }
    var formType = form.environment.ADDON_MSG_TYPE;
    if (!formType) {
        throw "I don't know what form to display, since"
            + "I received " + JSON.stringify(formType)
            + " instead of the name of a form.\n";
    }
    if (['draft', 'read', 'unread'].indexOf(form.environment.message_status) >= 0) {
        const receiverFileName = formType.replace(/\.([^.]*)$/, '.receiver.$1');
        if (fs.existsSync(path.join(PackItForms, receiverFileName))) {
            formType = receiverFileName;
        }
    }
    try {
        var html = fs.readFileSync(path.join(PackItForms, formType), ENCODING);
    } catch(err) {
        throw "I don't know about a form named "
            + JSON.stringify(form.environment.ADDON_MSG_TYPE) + "."
            + " Perhaps the message came from a newer version of this "
            + form.environment.addon_name + " add-on, "
            + 'so it might help if you install the latest version.'
            + '\n\n' + err;
    }
    html = expandDataIncludes(html, form);
    if (form.environment.emailing) {
        form.environment.message_status = 'sent';
        delete form.environment.emailing;
    }
    res.end(html, CHARSET);
}

function showManualMessage(formId, form, res) {
    const template = path.join('bin', 'message.html');
    fs.readFile(template, {encoding: ENCODING}, function(err, data) {
        try {
            if (err) throw err;
            res.end(expandVariables(data,
                                    {SUBJECT: encodeHTML(form.environment.subject),
                                     MESSAGE: encodeHTML(form.message),
                                     MESSAGE_URL: '/message-' + formId
                                     + '/' + encodeURIComponent(form.environment.subject)}),
                    CHARSET);
        } catch(err) {
            res.end(errorToHTML(err, form.environment), CHARSET);
        }
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
    fs.stat(SETTINGS_FILE, function(err, stats) {
        if (err || !(stats && stats.mtime)) {
            settings = DEFAULT_SETTINGS;
        } else {
            const fileTime = stats.mtime.getTime();
            if (fileTime != settingsUpdatedTime) {
                fs.readFile(SETTINGS_FILE, {encoding: ENCODING}, function(err, data) {
                    try {
                        if (err) throw err;
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
                        settings = merge(DEFAULT_SETTINGS, fileSettings);
                        log('settings = ' + JSON.stringify(settings));
                    } catch(err) {
                        log(err);
                    }
                });
            }
        }
    });
}

/* Expand data-include-html elements, for example:
  <div data-include-html="ics-header">
    {
      "5.": "PRIORITY",
      "9b.": "_.msgno2name(_.query.msgno)"
    }
  </div>
*/
function expandDataIncludes(data, form) {
    var oldData = data.replace(
        /<\s*script\b[^>]*\bsrc\s*=\s*"resources\/integration\/integration.js"/,
        '<script type="text/javascript">'
            + '\n      var integrationEnvironment = ' + JSON.stringify(form.environment)
            + ';\n      var integrationMessage = ' + JSON.stringify(form.message)
            + ';\n    </script>\n    $&');
    // It would be more elegant to inject data into integration.js,
    // but sadly that file is cached by the Chrome browser.
    // So changes would be ignored by the browser, for example
    // the change to message_status after emailing a message.
    while(true) {
        var newData = expandDataInclude(oldData, form);
        if (newData == oldData) {
            return oldData;
        }
        oldData = newData; // and try it again, in case there are nested includes.
    }
}

function expandDataInclude(data, form) {
    const target = /<\s*div\s+data-include-html\s*=\s*"[^"]*"\s*>[^<]*<\/\s*div\s*>/gi;
    return data.replace(target, function(found) {
        const matches = found.match(/"([^"]*)"\s*>([^<]*)/);
        const name = matches[1];
        const formDefaults = htmlEntities.decode(matches[2].trim());
        log('data-include-html ' + name + ' ' + formDefaults);
        // Read a file from pack-it-forms:
        const fileName = path.join(PackItForms, 'resources', 'html', name + '.html')
        var result = fs.readFileSync(fileName, ENCODING);
        // Remove the enclosing <div></div>:
        result = result.replace(/^\s*<\s*div\s*>\s*/i, '');
        result = result.replace(/<\/\s*div\s*>\s*$/i, '');
        if (formDefaults) {
            result += `<script type="text/javascript">
  add_form_default_values(${formDefaults});
</script>
`;
        }
        return result;
    });
}

function noCache(res) {
    res.set({'Cache-Control': 'no-cache, no-store, must-revalidate', // HTTP 1.1
             'Pragma': 'no-cache', // HTTP 1.0
             'Expires': '0'}); // proxies
}

function onSaveMessage(formId, req) {
    const form = findForm(formId);
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
}

function onEmail(formId, message, res) {
    const form = findForm(formId);
    form.message = message;
    form.environment.emailing = true;
    form.environment.subject = subjectFromMessage(parseMessage(message));
    form.environment.mode = 'readonly';
    res.redirect('/form-' + formId);
}

function onSubmit(formId, q, res, fromOutpostURL) {
    const form = findForm(formId);
    const callback = function callback(err) {
        try {
            if (!err) {
                log('/form-' + formId + ' submitted');
                form.environment.mode = 'readonly';
                res.redirect('/form-' + formId);
                // Don't closeForm, so the operator can view it.
                // But do delete its save file (if any):
                const fileName = saveFileName(formId);
                fs.unlink(fileName, function(err) {
                    if (!err) log("Deleted " + fileName);
                });
            } else if ((typeof err) != 'object') {
                throw err;
            } else {
                res.set({'Content-Type': TEXT_HTML});
                form.fromOutpost = err;
                log('/form-' + formId + ' from Outpost ' + JSON.stringify(err));
                var page = PROBLEM_HEADER + EOL
                    + 'When the message was submitted, Outpost responded:<br/><br/>' + EOL
                    + '<iframe src="' + fromOutpostURL + '" style="width:95%;"></iframe><br/><br/>' + EOL;
                if (err.message) {
                    page += encodeHTML(err.message)
                        .replace(/[\r\n]+/g, '<br/>' + EOL) + '<br/>' + EOL;
                }
                if (logFileName) {
                    page += encodeHTML('log file ' + logFileName) + '<br/>' + EOL;
                }
                page += '</body></html>';
                res.end(page, CHARSET);
            }
        } catch(err) {
            res.set({'Content-Type': TEXT_HTML});
            res.end(errorToHTML(err, form.environment), CHARSET);
        }
    };
    try {
        const message = q.formtext;
        const parsed = parseMessage(message);
        const fields = parsed.fields;
        const severity = fields['4.'] || '';
        const handling = fields['5.'] || '';
        form.environment.subject = subjectFromMessage(parsed);
        if (form.environment.message_status == 'manual') {
            form.environment.message_status = 'manual-created';
            form.message = message;
            res.redirect('/form-' + formId);
        } else {
            // Outpost requires Windows-style line breaks:
            form.message = message.replace(/([^\r])\n/g, '$1' + EOL);
            submitToOpdirect({
                formId: formId,
                form: form,
                addonName: form.environment.addon_name,
                subject: form.environment.subject,
                urgent: (['IMMEDIATE', 'I'].indexOf(handling) >= 0)
            }, callback);
        }
    } catch(err) {
        callback(err);
    }
}

function submitToOpdirect(submission, callback) {
    try {
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
        const message = submission.form.message
              ? '&' + querystring.stringify({msg: submission.form.message})
              : '';
        const options = settings.Opdirect;
        // Send an HTTP request.
        const server = request(
            options,
            function(err, data, res) {
                try {
                    if (data == null) data = '';
                    log('/form-' + submission.formId + ' from Opdirect {' + err + '} ' + data);
                    if (err) {
                        if (err == 'req.timeout' || err == 'res.timeout') {
                            err = "Outpost didn't respond within " + SUBMIT_TIMEOUT_SEC + ' seconds.'
                                + EOL + JSON.stringify(options);
                        } else if ((err + '').indexOf(' ECONNREFUSED ') >= 0) {
                            err = "Opdirect isn't running, it appears." + EOL + err
                                + EOL + JSON.stringify(options);
                        }
                        callback(err);
                    } else if (data.indexOf('Your PacFORMS submission was successful!') >= 0) {
                        // It's an old version of Outpost. Maybe Aoclient will work:
                        submitToAoclient(submission, callback);
                    } else if (res.statusCode < 200 || res.statusCode >= 300) {
                        callback({message: 'HTTP status ' + res.statusCode + ' ' + res.statusMessage,
                                  headers: copyHeaders(res.headers),
                                  body: data});
                    } else {
                        var returnCode = 0;
                        // Look for <meta name="OpDirectReturnCode" content="403"> in the body:
                        var matches = data.match(/<\s*meta\s+[^>]*\bname\s*=\s*"OpDirectReturnCode"[^>]*/i);
                        if (matches) {
                            matches = matches[0].match(/\s+content\s*=\s*"\s*([^"]*)\s*"/i);
                            if (matches) {
                                returnCode = parseInt(matches[1]);
                            }
                        }
                        if (returnCode < 200 || returnCode >= 300) {
                            callback({message: 'OpDirectReturnCode ' + returnCode,
                                      headers: copyHeaders(res.headers),
                                      body: data});
                        } else {
                            callback(); // success
                        }
                    }
                } catch(err) {
                    callback(err);
                }
            });
        server.setHeader('Content-Type', 'application/x-www-form-urlencoded');
        server.setTimeout(SUBMIT_TIMEOUT_SEC * seconds);
        log('/form-' + submission.formId + ' submitting ' + JSON.stringify(options) + ' ' + body);
        // URL encode the 'E' in '#EOF', to prevent Outpost from treating this as a PacFORM message:
        body = (body + message).replace(/%23EOF/gi, function(match) {
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
        server.end(body);
    } catch(err) {
        try {
            log(err);
            submitToAoclient(submission, callback);
        } catch(err) {
            callback(err);
        }
    }
}

function submitToAoclient(submission, callback) {
    const msgFileName = path.resolve(PackItMsgs, 'form-' + submission.formId + '.txt');
    // Remove the first line of the Outpost message header:
    const message = submission.form.message.replace(/^\s*![^\r\n]*[\r\n]+/, '')
    // Outpost will insert !submission.addonName!.
    fs.writeFile(msgFileName, message, {encoding: ENCODING}, function(err) {
        try {
            if (err) throw err;
            try {
                fs.unlinkSync(OpdFAIL);
            } catch(err) {
                // ignored
            }
            var options = ['-a', submission.addonName,
                           '-f', msgFileName,
                           '-s', submission.subject];
            if (submission.urgent) {
                options.push('-u');
            }
            const program = path.join ('addons', submission.addonName, 'Aoclient.exe');
            log('/form-' + submission.formId + ' submitting ' + program + ' ' + options.join(' '));
            child_process.execFile(
                program, options,
                function(err, stdout, stderr) {
                    try {
                        if (err) throw err;
                        if (fs.existsSync(OpdFAIL)) {
                            throw (OpdFAIL + ': ' + fs.readFileSync(OpdFAIL, ENCODING) + '\n\n'
                                   + stdout.toString(ENCODING)
                                   + stderr.toString(ENCODING));
                        }
                        callback();
                        try {
                            fs.unlinkSync(msgFileName);
                        } catch(err) {
                            if (err) log(err);
                            else log("Deleted " + msgFileName);
                        }
                    } catch(err) {
                        callback(err);
                    }
                });
        } catch(err) {
            callback(err);
        }
    });
}

/** Handle an HTTP GET /manual request. */
function onGetManual(res) {
    keepAlive(0);
    res.set({'Content-Type': TEXT_HTML});
    const template = path.join('bin', 'manual.html');
    fs.readFile(template, {encoding: ENCODING}, function(err, data) {
        if (err) {
            res.send(errorToHTML(err, template));
        } else {
            try {
                var forms = getAddonForms();
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
            } catch(err) {
                res.send(errorToHTML(err, forms));
            }
        }
        res.end();
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
    getAddonNames().forEach(function(addonName) {
        fs.readFileSync(path.join('addons', addonName + '.launch'), {encoding: ENCODING})
            .split(/[\r\n]+/).forEach(function(line) {
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
    });
    return addonForms;
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
    try {
        const deadline = (new Date).getTime() - ageLimitMs;
        fs.readdir(directoryName, function(err, fileNames) {
            if (err) {
                log(err);
            } else {
                fileNames.forEach(function(fileName) {
                    if (fileNamePattern.test(fileName)) {
                        var fullName = path.join(directoryName, fileName);
                        fs.stat(fullName, (function(fullName) {
                            // fullName is constant in this function, not a var in deleteOldFiles.
                            return function(err, stats) {
                                // This is the callback from fs.stat.
                                if (err) {
                                    log(err);
                                } else if (stats.isFile()) {
                                    var fileTime = stats.mtime.getTime();
                                    if (fileTime < deadline) {
                                        fs.unlink(fullName, function(err) {
                                            log(err ? err : ("Deleted " + fullName));
                                        });
                                    }
                                }
                            };
                        })(fullName));
                    }
                });
            }
        });
    } catch(err) {
        log(err);
    }
}

function logToFile(fileNameSuffix) {
    if (!fs.existsSync('logs')) {
        fs.mkdirSync('logs');
    }
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
                 const nextFileName = path.join('logs', prefix + fileNameSuffix +'.log');
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
                     deleteOldFiles('logs', /\.log$/, 7 * 24 * hours);
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
    if (!fs.existsSync(path.dirname(intoFile))) {
        fs.mkdirSync(path.dirname(intoFile)); // fail fast
    }
    fs.readFile(fromFile, ENCODING, function(err, data) {
        if (err) logAndAbort(err);
        var newData = expandVariables(data, variables);
        if (newData != data || intoFile != fromFile) {
            fs.writeFile(intoFile, newData, {encoding: ENCODING}, function(err) {
                if (err) logAndAbort(err);
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

function logAndAbort(err) {
    log(err);
    process.exit(1);
}

function encodeHTML(text) {
    return htmlEntities.encode(text + '');
}

function enquoteRegex(text) {
    // Crude but adequate:
    return ('' + text).replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}
