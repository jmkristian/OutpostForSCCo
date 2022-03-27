#!/bin/bash
# This script can be executed by the bash that's packaged with git for Windows.
cd `dirname "$0"` || exit $?
if [ `node --version` != "v10.18.1" ]; then
    nvm use 10.18.1 32 || exit $? # https://github.com/coreybutler/nvm-windows
fi
npm install || exit $? # https://docs.npmjs.com/cli/install
rm -rf built
mkdir built || exit $?
node_modules/.bin/pkg.cmd -t node10-win-x86 bin/WebToPDF.js || exit $?
node_modules/.bin/pkg.cmd -t node10-win-x86 setVersion.js || exit $?
mv setVersion.exe built/ || exit $?
built/setVersion.exe WebToPDF.exe built/WebToPDF.exe 2.0.0 WebToPDF "Convert web pages to PDF files." || exit $?
rm WebToPDF.exe
cd ..; ./sign.cmd webToPDF\\built\\WebToPDF.exe || exit $?
