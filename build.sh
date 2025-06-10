#!/bin/bash
# This script can be executed by the bash that's packaged with git for Windows.
cd `dirname "$0"` || exit $?
export VersionMajor=3
export VersionMinor=19
export VersionBeta=
rm -rf built logs
mkdir -p built/bin built/webToPDF
if [ `node --version` != "v4.9.1" ]; then
    nvm use 4.9.1 32 || exit $? # https://github.com/coreybutler/nvm-windows
    if [ `node --version` != "v4.9.1" ]; then
        echo >&2 node version 4.9.1 is required, to package code compatible with Windows XP.
        exit 1
    fi
fi
if [ ! -e node_modules ]; then
    npm install || exit $? # https://docs.npmjs.com/cli/install
fi
node_modules/.bin/pkg.cmd -t node4-win-x86 bin/Outpost_Forms.js || exit $?
mv Outpost_Forms.exe built/ || exit $?
rm -f pack-it-forms/resources/integration/integration.js

for REPO in jmkristian/pack-it-forms "$@"; do
    export FORMS=$(basename "$REPO")
    if [ ! -e "$FORMS"/.git ]; then # Don't delete an experimental copy.
        rm -rf "$FORMS"
    fi
    if [ ! -e "$FORMS" ]; then
        git clone https://github.com/"$REPO".git || exit $?
        (cd "$FORMS" && git checkout vSCCo.52)
        rm -rf "$FORMS"/.git*
    fi
    "$FORMS"/resources/integration/scco/build.sh ./buildInstaller.sh\
            "$VersionMajor.$VersionMinor$VersionBeta" || exit $?
done
