#!/bin/bash
# This script can be executed by the bash that's packaged with git for Windows.
cd `dirname "$0"` || exit $?
if [ `node --version` != "v10.18.1" ]; then
    nvm use 10.18.1 32 || exit $? # https://github.com/coreybutler/nvm-windows
fi
npm install || exit $? # https://docs.npmjs.com/cli/install
node_modules/.bin/pkg.cmd -t node10-win-x86 WebToPDF.js || exit $?
