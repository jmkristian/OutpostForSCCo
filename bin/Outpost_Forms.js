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
  - This program POSTs the arguments to a server, which then
  - launches a browser, which GETs an HTML form from the server.
  - When the operator clicks "Submit", the browser POSTs a message to the server,
  - and the server runs Aoclient.exe, which submits the message to Outpost.

  The server is a process running this program with a single argument "serve".
  The server is started as a side-effect of creating or opening a message.
  When this program tries and fails to POST arguments to the server,
  it tries to start the server, delays a bit and retries the POST.
  The server continues to run as long as any of the forms it serves are open,
  plus a couple minutes. To implement this, the browser pings the server
  periodically, and the server notices when the pings stop.

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
*/
const AllHtmlEntities = require('html-entities').AllHtmlEntities;
const bodyParser = require('body-parser');
const child_process = require('child_process');
const concat_stream = require('concat-stream');
const express = require('express');
const fs = require('fs');
const http = require('http');
const morgan = require('morgan');
const net = require('net');
const os = require('os');
const path = require('path');
const querystring = require('querystring');
const stream = require('stream');
const url = require('url');
const util = require('util');

const CHARSET = 'utf-8'; // for HTTP
const ENCODING = CHARSET; // for reading from files
const EOL = '\r\n';
const FORBIDDEN = 403;
const htmlEntities = new AllHtmlEntities();
const JSON_TYPE = 'application/json';
const LOCALHOST = '127.0.0.1';
const seconds = 1000;
const hours = 60 * 60 * seconds;
const NOT_FOUND = 404;
const OpdFAIL = 'OpdFAIL';
const OpenOutpostMessage = '/openOutpostMessage';
const PackItForms = 'pack-it-forms';
const PackItMsgs = path.join(PackItForms, 'msgs');
const PortFileName = path.join('logs', 'server-port.txt');
const PROBLEM_HEADER = '<html><head><title>Problem</title></head><body>'
      + EOL + '<h3><img src="icon-warning.png" alt="warning"'
      + ' style="width:24pt;height:24pt;vertical-align:middle;margin-right:1em;">'
      + 'Something went wrong.</h3>';
const StopServer = '/stopOutpostForLAARES';
const SUBMIT_TIMEOUT_SEC = 30;
const TEXT_HTML = 'text/html; charset=' + CHARSET;
const TEXT_PLAIN = 'text/plain; charset=' + CHARSET;

var logFileName = null;

if (process.argv.length > 2) {
    // With no arguments, do nothing quietly.
    const verb = process.argv[2];
    if (verb != 'serve') {
        logToFile(verb);
    }
    try {
        switch(verb) {
        case 'build':
            // Customize various files for a given add-on.
            // This happens before creating an installer.
            build(process.argv[3], process.argv[4], process.argv[5]);
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
        default:
            log(process.argv[1] + ': unknown verb "' + verb + '"');
        }
    } catch(err) {
        log(err);
    }
}

function build(addonName, programPath, displayName) {
    expandVariablesInFile({addon_name: addonName, PROGRAM_PATH: programPath},
                          path.join('bin', 'addon.ini'),
                          path.join('built', 'addons', addonName + '.ini'));
    expandVariablesInFile({addon_name: addonName},
                          path.join('bin', 'Aoclient.ini'),
                          path.join('built', 'addons', addonName, 'Aoclient.ini'));
    expandVariablesInFile({addon_name: addonName},
                          path.join('bin', 'manual.html'),
                          path.join('built', 'manual.html'));
    ['browse.cmd', 'launch-v.cmd', 'launch.cmd', 'launch.vbs', 'UserGuide.html'].forEach(function(fileName) {
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
}

function installConfigFiles(myDirectory, addonNames) {
    var launch = process.argv[3] + ' ' + path.join(myDirectory, 'bin', 'launch.vbs');
    const version = os.release().split(/\./);
    const majorVersion = parseInt(version[0], 10);
    if (majorVersion < 6) {
        // We're running on Windows XP or Windows Server 2003, per
        // https://docs.microsoft.com/en-us/windows/desktop/api/winnt/ns-winnt-_osversioninfoa#remarks
        // Use launch.cmd instead of launch.vbs:
        launch = path.join(myDirectory, 'bin', 'launch.cmd');
    }
    expandVariablesInFile({INSTDIR: myDirectory, LAUNCH: launch}, 'UserGuide.html');
    addonNames.forEach(function(addon_name) {
        expandVariablesInFile({INSTDIR: myDirectory, LAUNCH: launch},
                              path.join('addons', addon_name + '.ini'));
    });
}

/* Make sure Outpost's Launch.local files include addons/*.launch. */
function installIncludes(myDirectory, addonNames) {
    const oldInclude = new RegExp('^INCLUDE[ \\t]+' + enquoteRegex(myDirectory) + '[\\\\/]', 'i');
    var myIncludes = addonNames.map(function(addonName) {
        return 'INCLUDE ' + path.resolve(myDirectory, 'addons', addonName + '.launch');
    });
    // Each of the process arguments names a directory that contains Outpost configuration data.
    for (var a = 4; a < process.argv.length; a++) {
        var outpostLaunch = path.resolve(process.argv[a], 'Launch.local');
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
            var outpostLaunch = path.resolve(process.argv[a], 'Launch.local');
            if (fs.existsSync(outpostLaunch)) {
                // Remove INCLUDEs from outpostLaunch:
                addonNames.forEach(function(addonName) {
                    var myLaunch = enquoteRegex(path.resolve(process.cwd(), 'addons', addonName + '.launch'));
                    var myInclude1 = new RegExp('^INCLUDE[ \\t]+' + myLaunch + '[\r\n]*', 'i');
                    var myInclude = new RegExp('[\r\n]+INCLUDE[ \\t]+' + myLaunch + '[\r\n]+', 'gi');
                    fs.readFile(outpostLaunch, ENCODING, function(err, data) {
                        if (err) {
                            log(err);
                        } else {
                            var newData = data.replace(myInclude1, '').replace(myInclude, EOL);
                            if (newData != data) {
                                fs.writeFile(outpostLaunch, newData, {encoding: ENCODING}, function(err) {
                                    log(err ? err : ('removed ' + addonName + ' from ' + outpostLaunch));
                                });
                            }
                        }
                    });
                });
            }
        }
    });
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
    var programPath = process.argv[3];
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
            if (retries == 1 || retries == 4) {
                startServer(programPath);
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
        data = data && data.trim();
        if (err) {
            tryLater(err);
        } else {
            process.exit(0); // mission accomplished
        }
    }).end(postData, CHARSET);
}

function startServer(programPath) {
    const command = 'start /B ' + programPath + ' serve';
    log(command);
    child_process.exec(
        command,
        {windowsHide: true},
        function(err, stdout, stderr) {
            // Sadly, this code is never executed.
            // It appears that the underlying system call blocks until
            // the server terminates, or perhaps a long time elapses.
            // So, don't put code here that's needed to make progress.
            log(err);
            log('started server ' + stdout.toString(ENCODING) + stderr.toString(ENCODING));
        });
}

function stopServers(next) {
    try {
        // Find the port numbers of all servers (including stopped servers):
        var ports = [];
        const fileNames = fs.readdirSync('logs', {encoding: ENCODING});
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
        function join(err) {
            log(err);
            if (--forked <= 0) {
                next();
            }
        }
        ports.forEach(function(port) {
            try {
                stopServer(parseInt(port, 10), join);
            } catch(err) {
                join(err);
            }
        });
    } catch(err) {
        log(err);
        next();
    }
}

function stopServer(port, next) {
    log('stopping server on port ' + port);
    request({host: LOCALHOST,
             port: port,
             method: 'POST',
             path: StopServer},
            next).end();
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

var openForms = {'0': {quietSeconds: 0}}; // all the forms that are currently open
// Form 0 is a hack to make sure the server doesn't shut down immediately after starting.
var nextFormId = 1; // Forms are assigned sequence numbers when they're opened.

function serve() {
    const app = express();
    var port;
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
        const args = req.body;
        res.end();
        if (args && args.length > 0) {
            const formId = '' + nextFormId++;
            onOpen(formId, args);
            const command = 'start "Browse" /B http://' + LOCALHOST + ':' + port + '/form-' + formId;
            log(command);
            child_process.exec(
                command,
                function(err, stdout, stderr) {
                    log(err);
                    log('started browser ' + stdout.toString(ENCODING) + stderr.toString(ENCODING));
                });
        }
    });
    app.get('/form-:formId', function(req, res, next) {
        keepAlive(req.params.formId);
        onGetForm(req.params.formId, res);
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
        log('stopped');
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
                            '--ADDON_MSG_TYPE', form.substring(space + 1)]);
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
            if (req.body.message) {
                args.push('--addon_name');
                args.push(req.body.message.match(/^\s*!([^!\r\n]*)!/)[1])
            }
            const formId = '' + nextFormId++;
            onOpen(formId, args);
            res.redirect('/form-' + formId);
        } catch(err) {
            res.set({'Content-Type': TEXT_HTML});
            res.end(errorToHTML(err, JSON.stringify(req.body)), CHARSET);
        }
    });
    app.get('/resources/integration/*', function(req, res, next) {
        getIntegrationFile(req, res);
    });
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
    port = address.port;
    if (!fs.existsSync('logs')) {
        fs.mkdirSync('logs');
    }
    fs.writeFileSync(PortFileName, port + '', {encoding: ENCODING}); // advertise my port
    logToFile('server-' + port);
    log('Listening for HTTP requests on port ' + port + '...');
    const checkSilent = setInterval(function() {
        // Scan openForms and close any that have been quiet too long.
        var anyOpen = false;
        for (formId in openForms) {
            var form = openForms[formId];
            if (form) {
                form.quietSeconds += 5;
                // The client is expected to GET /ping-formId every 30 seconds.
                if (form.quietSeconds >= 300) {
                    closeForm(formId);
                } else {
                    anyOpen = true;
                }
            }
        }
        if (!anyOpen) {
            log('forms are all closed');
            clearInterval(checkSilent);
            server.close();
            fs.readFile(PortFileName, {encoding: ENCODING}, function(err, data) {
                if (data.trim() == (port + '')) {
                    fs.unlink(PortFileName, log);
                }
                process.exit(0);
            });
        }
    }, 5000);
}

function onOpen(formId, args) {
    // This code should be kept dead simple, since
    // it can't show a problem to the operator.
    openForms[formId] = {
        args: args,
        quietSeconds: 0
    };
    log('/form-' + formId + ' opened');
}

function keepAlive(formId) {
    form = openForms[formId];
    if (form) {
        form.quietSeconds = 0;
    } else if (formId == "0") {
        openForms[formId] = {quietSeconds: 0};
    }
}

function closeForm(formId) {
    var form = openForms[formId];
    if (form) {
        log('/form-' + formId + ' closed');
        if (form.environment && form.environment.MSG_FILENAME) {
            const msgFileName = path.resolve(PackItMsgs, form.environment.MSG_FILENAME);
            fs.unlink(msgFileName, function(err) {
                if (err) log(err);
                else log("Deleted " + msgFileName);
            });
        }
    }
    delete openForms[formId];
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
    }
    if (message) {
        // Outpost sometimes appends junk to the end of message.
        // One observed case was "You have new messages."
        message = message.replace(/[\r\n]+[ \t]*!\/ADDON![\s\S]*$/, EOL + '!/ADDON!' + EOL);
    }
    return message;
}

/** Handle an HTTP GET /form-id request. */
function onGetForm(formId, res) {
    noCache(res);
    res.set({'Content-Type': TEXT_PLAIN});
    var form = openForms[formId];
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
            if (!form.environment) {
                form.environment = parseArgs(form.args);
                form.environment.pingURL = '/ping-' + formId;
                form.environment.submitURL = '/submit-' + formId;
            }
            if (form.message == null) {
                form.message = getMessage(form.environment);
                if (form.message) {
                    if (!form.environment.ADDON_MSG_TYPE) {
                        var foundFilename = /[\r\n]#[ \t]*(T|FORMFILENAME):([^\r\n]*)[\r\n]/.exec(form.message);
                        if (foundFilename) {
                            form.environment.ADDON_MSG_TYPE = foundFilename[2].trim();
                        } else {
                            throw new Error(
                                "I don't know what form to display, since"
                                    + "\nthe message doesn't have a line that starts with '#T: ' or '# FORMFILENAME: '.");
                        }
                    }
                }
            }
            log(form.environment);
            if (!form.environment.addon_name) {
                throw new Error('addon_name is ' + form.environment.addon_name);
            }
            var formFileName = form.environment.ADDON_MSG_TYPE;
            if (!formFileName) {
                throw new Error("I don't know what form to display, since "
                                + "\nI received " + JSON.stringify(formFileName)
                                + " instead of the name of a form.");
            }
            if (['draft', 'read', 'unread'].indexOf(form.environment.message_status) >= 0) {
                const receiverFileName = formFileName.replace(/\.([^.]*)$/, '.receiver.$1');
                if (fs.existsSync(path.join(PackItForms, receiverFileName))) {
                    formFileName = receiverFileName;
                }
            }
            try {
                var html = fs.readFileSync(path.join(PackItForms, formFileName), ENCODING);
            } catch(err) {
                throw new Error("I don't know about a form named "
                                + JSON.stringify(form.environment.ADDON_MSG_TYPE) + ".\n"
                                + "Perhaps this message came from a newer version of this "
                                + form.environment.addon_name + " add-on,\n"
                                + "so it might help if you install the latest version.\n"
                                + err);
            }
            html = expandDataIncludes(html, form);
            res.send(html);
        } catch(err) {
            res.send(errorToHTML(err, form));
        }
    }
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
    var oldData = data;
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

function getIntegrationFile(req, res) {
    try {
        noCache(res);
        const fileName =
              path.join(PackItForms, req.path.substring(1).replace('/integration/', '/integration/scco/'));
        log('get integration file ' + fileName);
        fs.readFile(fileName, ENCODING, function(err, body) {
            try {
                if (err) throw err;
                const referer = req.headers.referer || req.headers.referrer;
                const formId = parseInt(referer.substring(referer.lastIndexOf('-') + 1));
                const form = openForms[formId];
                log('/form-' + formId + ' expand integration file');
                // Insert some stuff:
                body = expandVariables(body,
                                       {message: JSON.stringify(form.message),
                                        environment: JSON.stringify(form.environment)});
                res.end(body, CHARSET);
            } catch(err) {
                res.set({'Content-Type': TEXT_HTML});
                res.end(errorToHTML(err, JSON.stringify(fileName)
                                    + EOL + JSON.stringify(req.headers)),
                        CHARSET);
            }
        });
    } catch(err) {
        res.set({'Content-Type': TEXT_HTML});
        res.end(errorToHTML(err, JSON.stringify(req.path)), CHARSET);
    }
}

function noCache(res) {
    res.set({'Cache-Control': 'no-cache, no-store, must-revalidate', // HTTP 1.1
             'Pragma': 'no-cache', // HTTP 1.0
             'Expires': '0'}); // proxies
}

function onSubmit(formId, q, res, fromOutpostURL) {
    const form = openForms[formId];
    const callback = function callback(err) {
        try {
            if (!err) {
                log('/form-' + formId + ' submitted');
                form.environment.mode = 'readonly';
                res.redirect('/form-' + formId);
                // Don't closeForm, so the operator can view it.
            } else {
                res.set({'Content-Type': TEXT_HTML});
                if ((typeof err) != 'object') {
                    throw err;
                }
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
                res.end(page);
            }
        } catch(err) {
            res.set({'Content-Type': TEXT_HTML});
            res.end(errorToHTML(err, form.environment), CHARSET);
        }
    };
    try {
        var subject = '';
        var message = q.formtext.replace(
            /[\r\n]*#[ \t]*Subject:[ \t]*([^\r\n]*)/i,
            function(found, $1) {
                subject = $1;
                return '';
            });
        const foundSeverity = /[\r\n]4.:[ \t]*\[([A-Za-z]*)]/.exec(message);
        const severity = foundSeverity ? foundSeverity[1].toUpperCase() : '';
        const foundHandling = /[\r\n]5.:[ \t]*\[([A-Za-z]*)]/.exec(message);
        const handling = foundHandling ? foundHandling[1].toUpperCase() : '';
        // Outpost requires Windows-style line breaks:
        form.message = message.replace(/([^\r])\n/g, '$1' + EOL);
        if (form.environment.message_status == 'manual') {
            res.set({'Content-Type': TEXT_PLAIN});
            res.end(message, CHARSET);
        } else {
            submitToOpdirect({
                formId: formId,
                form: form,
                addonName: form.environment.addon_name,
                subject: subject,
                urgent: (['URGENT', 'U', 'EMERGENCY', 'E'].indexOf(severity) >= 0)
                    || (['IMMEDIATE', 'I'].indexOf(handling) >= 0)
            }, callback);
        }
    } catch(err) {
        callback(err);
    }
}

function submitToOpdirect(submission, callback) {
    try {
        if (!submission.addonName) throw 'addonName is required'; 
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
        const options = {method: 'POST', host: LOCALHOST, port: 9334, path: '/TBD'};
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
    const formFileName = submission.form.environment.ADDON_MSG_TYPE;
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
                            throw (OpdFAIL + ': ' + fs.readFileSync(OpdFAIL, ENCODING) + '\n'
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
        + encodeHTML(errorToMessage(err)).replace(/[\r\n]+/g, '<br/>' + EOL) + '<br/>' + EOL;
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
                                            if (err) log(err);
                                            else log("Deleted " + fullName);
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
                log('wrote ' + intoFile);
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
