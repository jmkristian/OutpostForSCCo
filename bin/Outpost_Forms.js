/* Copyright 2018 by John Kristian

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
  For example, "node bin/Outpost_Forms.js uninstall C:/Outpost"
  edits C:/Outpost/Launch.local.

  When an operator clicks a menu item to create a message
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
const os = require('os');
const path = require('path');
const Transform = require('stream').Transform;
const util = require('util');

const CHARSET = 'utf-8'; // for HTTP
const ENCODING = CHARSET; // for reading from files
const EOL = '\r\n';
const htmlEntities = new AllHtmlEntities();
const IconStyle = 'width:24pt;height:24pt;vertical-align:middle;';
const JSON_TYPE = 'application/json';
const LOCALHOST = '127.0.0.1';
const LogFileAgeLimitMs = 1000 * 60 * 60 * 24; // 24 hours
const NOT_FOUND = 404;
const OpdFAIL = 'OpdFAIL';
const OpenOutpostMessage = '/openOutpostMessage';
const PackItForms = 'pack-it-forms';
const PackItMsgs = path.join(PackItForms, 'msgs');
const PortFileName = path.join('logs', 'server-port.txt');
const StopServer = '/stopOutpostForLAARES';

if (process.argv.length > 2) {
    // With no arguments, do nothing quietly.
    const verb = process.argv[2];
    if (verb != 'serve') {
        logToFile(path.join('logs', verb + '.log'));
    }
    try {
        switch(verb) {
        case 'install':
            install();
            break;
        case 'uninstall':
            uninstall();
            break;
        case 'serve':
            serve();
            break;
        case 'open':
        case 'dry-run':
            openMessage();
            break;
        case 'stop':
            stopServers(function() {});
            break;
        default:
            log(process.argv[1] + ': unknown verb "' + verb + '"');
        }
    } catch(err) {
        log(err);
    }
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
    var launch = process.argv[3] + ' ' + path.join(myDirectory, 'launch.vbs');
    const version = os.release().split(/\./);
    const majorVersion = parseInt(version[0], 10);
    if (majorVersion < 6) {
        // We're running on Windows XP or Windows Server 2003, per
        // https://docs.microsoft.com/en-us/windows/desktop/api/winnt/ns-winnt-_osversioninfoa#remarks
        // Use launch.cmd instead of launch.vbs:
        launch = path.join(myDirectory, 'launch.cmd');
    }
    addonNames.forEach(function(addon_name) {
        expandVariablesInFile({addon_name: addon_name, INSTDIR: myDirectory, LAUNCH: launch},
                              path.join('bin', 'addon.ini'),
                              path.join('addons', addon_name + '.ini'));
        expandVariablesInFile({addon_name: addon_name},
                              path.join('bin', 'Aoclient.ini'),
                              path.join('addons', addon_name, 'Aoclient.ini'));
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
    var args = [];
    for (var i = 3; i < process.argv.length; i++) {
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
                startServer();
            }
            setTimeout(tryNow, retries * 1000);
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

function startServer() {
    const command = 'start /B '
          + path.join('bin', 'Outpost_Forms.exe')
          + ' serve';
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
    function onError(event) {
        return function(err) {
            (callback || log)(err || event);
        }
    }
    var req = http.request(options, function(res) {
        res.on('aborted', onError('aborted'));
        res.pipe(concat_stream(function(buffer) {
            var data = buffer.toString(CHARSET);
            if (callback) {
                callback(null, data);
            }
        }));
    });
    req.on('abort', onError('abort'));
    req.on('error', onError('error'));
    req.on('timeout', onError('timeout'));
    return req;
}

var openForms = {'0': {quietSeconds: 0}}; // all the forms that are currently open
// Form 0 is a hack to make sure the server doesn't shut down immediately after starting.
var nextFormId = 1; // Forms are assigned sequence numbers when they're opened.

function serve() {
    const app = express();
    var port;
    app.set('etag', false); // convenient for troubleshooting
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
        onSubmit(req.params.formId, req.body, res);
    });
    app.get('/ping-:formId', function(req, res, next) {
        keepAlive(req.params.formId);
        res.statusCode = NOT_FOUND;
        res.set({'Cache-Control': 'no-cache, no-store, must-revalidate', // HTTP 1.1
                 'Pragma': 'no-cache', // HTTP 1.0
                 'Expires': '0'}); // proxies
        res.end(); // with no body. The client ignores this response.
    });
    app.get('/msgs/:msgno', function(req, res, next) {
        // The client may not get the message this way,
        // since the server doesn't know what the formId is.
        // Instead, onGetForm includes JavaScript code
        // which passes the message to set_form_data_div.
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
                            '--filename', form.substring(space + 1)]);
            res.redirect('/form-' + formId);
        } catch(err) {
            res.set({'Content-Type': 'text/html; charset=' + CHARSET});
            res.end(errorToHTML(err, JSON.stringify(req.body)));
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
            res.set({'Content-Type': 'text/html; charset=' + CHARSET});
            res.end(errorToHTML(err, JSON.stringify(req.body)));
        }
    });
    app.get(/^\/.*/, express.static(PackItForms));

    const server = app.listen(0);
    const address = server.address();
    port = address.port;
    if (!fs.existsSync('logs')) {
        fs.mkdirSync('logs');
    }
    fs.writeFileSync(PortFileName, port + '', {encoding: ENCODING}); // advertise my port
    const logFileName = path.resolve('logs', 'server-' + port + '.log');
    logToFile(logFileName);
    log('Listening for HTTP requests on port ' + port + '...');
    deleteOldFiles('logs', /^server-\d*\.log$/, LogFileAgeLimitMs);
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
    log('form ' + formId + ' opened');
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
        log('form ' + formId + ' closed');
        if (form.environment && form.environment.MSG_FILENAME) {
            fs.unlink(path.resolve(PackItMsgs, form.environment.MSG_FILENAME), log);
        }
    }
    delete openForms[formId];
}

function parseArgs(args) {
    var environment = {};
    var envelope = {};
    for (var i = 0; i < args.length; i++) {
        var option = args[i];
        if (option.startsWith('--')) {
            var name = option.substring(2);
            var value = args[++i];
            if (name.startsWith('envelope.')) {
                envelope[name.substring(9)] = value;
            } else {
                environment[name] = value;
            }
        }
    }
    if (envelope.oDateTime) {
        var found = /(\S+)\s*(.*)/.exec(envelope.oDateTime);
        delete envelope.oDateTime;
        if (found) {
            envelope.ordate = found[1];
            envelope.ortime = found[2];
            found = /(\d+):(\d+)(:\d+)?([^\d]*)/.exec(envelope.ortime);
            if (found) {
                // convert to 24 hour time
                var hour = parseInt(found[1], 10);
                const min = found[2];
                const sec = found[3];
                const PM  = found[4].trim().toLowerCase() == 'pm';
                if (hour == 12) {
                    if (!PM) {
                        hour = 0;
                    }
                } else if (PM) {
                    hour += 12;
                } else if (hour < 10) {
                    hour = '0' + hour;
                }
                envelope.ortime = hour + ':' + min + (sec ? sec : '');
            }
        }
    }
    if (environment.msgno == '-1') { // a sentinel value
        delete environment.msgno;
    }
    if (envelope.RCVNUM == '-1') { // a sentinel value
        delete envelope.RCVNUM;
    } else if (envelope.RCVNUM) {
        environment.msgno = envelope.RCVNUM; // display it as My Msg #
    }
    return {envelope: envelope, environment: environment};
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

function parseMessage(message) {
    var fields = {};
    const lines = message.split(/[\r\n]+/);
    for (var l = 0; l < lines.length; l++) {
        var line = lines[l];
        var foundField = /^([^!#:][^:]*):\s*\[(.*)/.exec(line);
        if (foundField) {
            var name = foundField[1];
            var value = foundField[2];
            while(l < lines.length - 1 && (!value.endsWith(']') || (value.endsWith('`]') && !value.endsWith('``]')))) {
                value += EOL + lines[++l];
            }
            value = value.substring(0, value.length - 1); // remove the ']'
            value = value.replace(/`([`\]])/g, '$1');
            fields[name] = value;
        }
    }
    return fields;
}

/** Handle an HTTP GET /form-id request. */
function onGetForm(formId, res) {
    res.set({'Content-Type': 'text/html; charset=' + CHARSET});
    var form = openForms[formId];
    if (formId <= 0) {
        res.status(400).send('Form numbers start with 1.');
    } else if (!form) {
        log('form ' + formId + ' is not open');
        if (formId < nextFormId) {
            res.status(NOT_FOUND).send('Form ' + formId + ' was discarded, since the browser page was closed.');
        } else {
            res.status(NOT_FOUND).send('Form ' + formId + ' has not been opened.');
        }
    } else {
        log('form ' + formId + ' viewed');
        try {
            if (!form.environment) {
                var parsed = parseArgs(form.args);
                form.envelope = parsed.envelope;
                form.environment = parsed.environment;
                form.environment.pingURL = '/ping-' + formId;
                form.environment.submitURL = '/submit-' + formId;
            }
            if (form.message == null) {
                form.message = getMessage(form.environment);
                if (form.message) {
                    if (!form.environment.filename) {
                        var foundFilename = /[\r\n]#[ \t]*FORMFILENAME:([^\r\n]*)[\r\n]/.exec(form.message);
                        if (foundFilename) {
                            form.environment.filename = foundFilename[1].trim();
                        }
                    }
                    const status = form.environment.message_status;
                    if (!(status == 'unread' || status == 'read' || (form.envelope.ocall && form.envelope.oname))) {
                        const fields = parseMessage(form.message);
                        if (!form.envelope.ocall && fields.OpCall) {
                            form.envelope.ocall = fields.OpCall;
                        }
                        if (!form.envelope.oname && fields.OpName) {
                            form.envelope.oname = fields.OpName;
                        }
                    }
                }
            }
            log(form.envelope);
            log(form.environment);
            if (!form.environment.addon_name) {
                throw new Error('addon_name is ' + form.environment.addon_name);
            }
            if (!form.environment.filename) {
                throw new Error('filename is ' + form.environment.filename);
            }
            var html = fs.readFileSync(path.join(PackItForms, form.environment.filename), ENCODING);
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
      "9b.": "{{msgno|msgno2name}}"
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
        var matches = found.match(/"([^"]*)"\s*>([^<]*)/);
        var name = matches[1];
        var formDefaults = htmlEntities.decode(matches[2].trim());
        // Read a file from pack-it-forms:
        var fileName = path.join(PackItForms, 'resources', 'html', name + '.html')
        var result = fs.readFileSync(fileName, ENCODING);
        // Remove the enclosing <div></div>:
        result = result.replace(/^\s*<\s*div\s*>\s*/i, '');
        result = result.replace(/<\/\s*div\s*>\s*$/i, '');
        if (name == 'submit-buttons') {
            // Add some additional stuff:
            result += expandVariables(
                fs.readFileSync(path.join('bin', 'after-submit-buttons.html'), ENCODING),
                {message: JSON.stringify(form.message),
                 envelopeDefaults: JSON.stringify(form.envelope),
                 queryDefaults: JSON.stringify(form.environment)});
        }
        if (formDefaults) {
            log('formDefaultValues: ' + formDefaults);
            result += `<script type="text/javascript">
  var formDefaultValues;
  if (!formDefaultValues) {
      formDefaultValues = [];
  }
  formDefaultValues.push(${formDefaults});
</script>
`;
        }
        return result;
    });
}

function onSubmit(formId, q, res) {
    res.set({'Content-Type': 'text/html; charset=' + CHARSET});
    try {
        var message = q.formtext;
        const form = openForms[formId];
        const foundSubject = /[\r\n]#[ \t]*SUBJECT:[ \t]*([^\r\n]*)/.exec(message);
        const subject = foundSubject ? foundSubject[1] : '';
        const formFileName = form.environment.filename;
        const msgFileName = path.resolve(PackItMsgs, 'form-' + formId + '.txt');
        // Convert the message from PACF format to ADDON format:
        message = message.replace(/[\r\n]+#EOF[\s\S]*/, EOL + '!/ADDON!' + EOL);
        form.message = message;
        if (form.environment.message_status == 'manual') {
            res.set({'Content-Type': 'text/plain; charset=' + CHARSET});
            res.end(message);
            return;
        }
        // Remove the first line of the Outpost message header:
        // Aoclient.exe or Outpost will insert !addon_name!.
        message = message.replace(/^\s*![^\r\n]*[\r\n]+/, '');
        fs.writeFile(msgFileName, message, {encoding: ENCODING}, function(err) {
            if (err) {
                res.end(errorToHTML(err, form));
            } else {
                try {
                    fs.unlinkSync(OpdFAIL);
                } catch(err) {
                    // ignored
                }
                log('form ' + formId + ' submitting');
                child_process.execFile(
                    path.join('addons', form.environment.addon_name, 'Aoclient.exe'),
                    ['-a', form.environment.addon_name, '-f', msgFileName, '-s', subject],
                    function(err, stdout, stderr) {
                        try {
                            if (err) {
                                throw err;
                            } else if (fs.existsSync(OpdFAIL)) {
                                // This is described in the Outpost Add-on Implementation Guide version 1.2,
                                // but Aoclient.exe doesn't appear to implement it.
                                // Happily, it does pop up a window to explain what went wrong.
                                throw (OpdFAIL + ': ' + fs.readFileSync(OpdFAIL, ENCODING) + '\n'
                                       + stdout.toString(ENCODING)
                                       + stderr.toString(ENCODING));
                            } else {
                                res.redirect('/form-' + formId + '?mode=readonly');
                                /** At this point, the operator can click the browser 'back' button,
                                    edit the form and submit it to Outpost again. To prevent this:
                                form.environment.mode = 'readonly';
                                res.redirect('/form-' + formId);
                                    ... which causes the 'back' button to display a read-only form.
                                */
                                log('form ' + formId + ' submitted');
                                fs.unlinkSync(msgFileName);
                                // Don't closeForm, in case the operator goes back and submits it again.
                            }
                        } catch(err) {
                            res.end(errorToHTML(err, form));
                        }
                    });
            }
        });
    } catch(err) {
        res.end(errorToHTML(err, {formId: formId}));
    }
}

/** Handle an HTTP GET /manual request. */
function onGetManual(res) {
    keepAlive(0);
    res.set({'Content-Type': 'text/html; charset=' + CHARSET});
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

function getAddonForms() {
    var addonForms = [];
    getAddonNames().forEach(function(addonName) {
        fs.readFileSync(path.join('addons', addonName + '.launch'), {encoding: ENCODING})
            .split(/[\r\n]+/).forEach(function(line) {
                if (line.startsWith('ADDON ')) {
                    var addonForm = {};
                    var name = null;
                    line.split(/\s+/).forEach(function(token) {
                        if (token.startsWith('-')) {
                            name = token.substring(1);
                        } else if (name) {
                            addonForm[name] = token;
                        }
                    });
                    addonForms.push(addonForm);
                }
            });
    });
    return addonForms;
}

function errorToHTML(err, state) {
    const message = encodeHTML(EOL + errorToMessage(err) + EOL + JSON.stringify(state));
    return `<HTML><title>Problem</title><body>
  <h3><img src="icon-warning.png" alt="warning" style="${IconStyle}">&nbsp;&nbsp;Something went wrong.</h3>
  This information might help resolve the problem:<pre>${message}</pre>
</body></HTML>`;
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
                                        fs.unlink(fullName, log);
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

function logToFile(fileName) {
    const windowsEOL = new Transform({
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
    if (!fs.existsSync(path.dirname(fileName))) {
        fs.mkdirSync(path.dirname(fileName));
    }
    const fileStream = fs.createWriteStream(fileName, {autoClose: true});
    windowsEOL.pipe(fileStream);
    const writer = windowsEOL.write.bind(windowsEOL);
    process.stdout.write = process.stderr.write = writer;
}

function expandVariablesInFile(variables, fromFile, intoFile) {
    if (!intoFile) intoFile = fromFile;
    if (!fs.existsSync(path.dirname(intoFile))) {
        fs.mkdirSync(path.dirname(intoFile));
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
    return htmlEntities.encode(text);
}

function enquoteRegex(text) {
    // Crude but adequate:
    return ('' + text).replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}
