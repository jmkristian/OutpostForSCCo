#!/bin/bash
# This script can be executed by the bash that's packaged with git for Windows.
cd `dirname "$0"` || exit $?
rm -r logs
if [ ! -e node_modules ]; then
    npm install # https://nodejs.org
    npm install --global pkg@4.2.6 # https://github.com/zeit/pkg
fi
pkg.cmd -t node4-win-x86 bin/Outpost_Forms.js || exit $?

if [ ! -e pack-it-forms/.git ]; then # Don't delete an experimental copy.
    rm -rf pack-it-forms
fi
if [ ! -e pack-it-forms ]; then
    git clone "https://github.com/jmkristian/pack-it-forms.git" || exit $?
    (cd pack-it-forms && git checkout vSCCo.15)
    rm -rf pack-it-forms/.git*
fi

rm -f pack-it-forms/resources/integration/integration.js
./build.cmd || exit
cp -p pack-it-forms/resources/integration/pacread/* pack-it-forms/resources/integration/
mv Outpost_Forms.exe built/
