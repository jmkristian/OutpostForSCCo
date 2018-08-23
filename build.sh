#!/bin/bash
# This script can be executed by the bash that's packaged with git for Windows.
cd `dirname "$0"` || exit $?
if [ ! -e node_modules ]; then
    npm install # https://nodejs.org
    npm install -g pkg@4.2.6 # https://github.com/zeit/pkg
fi
pkg -t node4-win-x86 bin/launch.js || exit $?
mv launch.exe bin/

if [ ! -e pack-it-forms/.git ]; then # Don't delete an experimental copy.
    rm -rf pack-it-forms
fi
if [ ! -e pack-it-forms ]; then
    git clone "https://github.com/jmkristian/pack-it-forms.git" || exit $?
    (cd pack-it-forms && git checkout vLAARES.4)
    rm -rf pack-it-forms/.git*
fi

"C:/Program Files (x86)/NSIS/makensis.exe" setup.nsi || exit $? # http://nsis.sourceforge.net
