#!/usr/bin/node
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

const child_process = require('child_process');

const etc = require('./etc');
const CHARSET = etc.CHARSET;
const ENCODING = etc.ENCODING;
const EOL = etc.EOL;
const fsp = etc.fsp;
const httpExchange = etc.httpExchange;
const httpPromise = etc.httpPromise;
const log = etc.log;
const LOCALHOST = etc.LOCALHOST;
const LOG_FOLDER = etc.LOG_FOLDER;
const OpenOutpostMessage = etc.OpenOutpostMessage;
const PortFileName = etc.PortFileName;
const StopServer = etc.StopServer;

const HTTP_OK = etc.HTTP_OK;
const JSON_TYPE = etc.JSON_TYPE;
const SEE_OTHER = etc.SEE_OTHER;

const seconds = 1000;

/** Make sure a server is running, and then send process.argv[4..] to it. */
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

function startProcess(program, args, options) {
    log('startProcess(' + program + ', ' + args.join(' ') + ', ' + JSON.stringify(options) + ')');
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
            return etc.httpPromise(
                etc.httpExchange({
                    host: LOCALHOST,
                    port: parseInt(port, 10),
                    method: 'POST',
                    path: StopServer
                }) // no request data
            ).catch(log); // ignore response
        }));
    }).catch(log);
}

function argvSlice(start) {
    var args = [];
    for (var i = start; i < process.argv.length; i++) {
        args.push(process.argv[i]);
    }
    return args;
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

if (module == require.main) {
    etc.runCommand({
        'open': browseMessage,
        'dry-run': browseMessage,
        'stop': stopServers
    });
} else {
    exports = module.exports = {
        argvSlice: argvSlice,
        browseMessage: browseMessage,
        openMessage: openMessage,
        stopServers: stopServers
    }
}
