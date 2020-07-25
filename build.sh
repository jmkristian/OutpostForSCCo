#!/bin/bash
# This script can be executed by the bash that's packaged with git for Windows.
cd `dirname "$0"` || exit $?
export VersionMajor=3
export VersionMinor=0a
rm -rf built logs
mkdir built
if [ `node --version` != "v4.9.1" ]; then
    nvm use 4.9.1 32 || exit $? # https://github.com/coreybutler/nvm-windows
fi
if [ ! -e node_modules ]; then
    npm install || exit $? # https://docs.npmjs.com/cli/install
fi
node_modules/.bin/pkg.cmd -t node4-win-x86 bin/Outpost_Forms.js || exit $?
mv Outpost_Forms.exe built/ || exit $?
rm -f pack-it-forms/resources/integration/integration.js

for REPO in jmkristian/pack-it-forms "$@"; do
    FORMS=$(basename "$REPO")
    if [ ! -e "$FORMS"/.git ]; then # Don't delete an experimental copy.
        rm -rf "$FORMS"
    fi
    if [ ! -e "$FORMS" ]; then
        git clone https://github.com/"$REPO".git || exit $?
        (cd "$FORMS" && git checkout vSCCo.33)
        rm -rf "$FORMS"/.git*
    fi
    "$FORMS"/resources/integration/scco/build.cmd || exit
done
