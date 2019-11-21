#!/bin/bash
# This script can be executed by the bash that's packaged with git for Windows.
cd `dirname "$0"` || exit $?
export VersionMajor=2
export VersionMinor=18d
rm -r built logs
mkdir built
if [ ! -e node_modules ]; then
    npm install # https://nodejs.org
    npm install --global pkg@4.2.6 # https://github.com/zeit/pkg
fi
pkg.cmd -t node4-win-x86 bin/Outpost_Forms.js || exit $?
mv Outpost_Forms.exe built/
rm -f pack-it-forms/resources/integration/integration.js

for REPO in jmkristian/pack-it-forms "$@"; do
    FORMS=$(basename "$REPO")
    if [ ! -e "$FORMS"/.git ]; then # Don't delete an experimental copy.
        rm -rf "$FORMS"
    fi
    if [ ! -e "$FORMS" ]; then
        git clone https://github.com/"$REPO".git || exit $?
        (cd "$FORMS" && git checkout vSCCo.27c)
        rm -rf "$FORMS"/.git*
    fi
    "$FORMS"/resources/integration/scco/build.cmd || exit
done

cp -p pack-it-forms/resources/integration/pacread/* pack-it-forms/resources/integration/
