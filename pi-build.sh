#!/bin/bash
VersionMajor=2
VersionMinor=21c
cd `dirname "$0"` || exit $?
if [ ! -e node_modules ]; then
    npm install || exit $? # https://docs.npmjs.com/cli/install
fi
#if [ ! -e "pack-it-forms"/.git ]; then # Don't delete an experimental copy.
#    rm -rf "pack-it-forms"
#fi
if [ ! -e "pack-it-forms" ]; then
    git clone https://github.com/jmkristian/pack-it-forms.git || exit $?
    (cd "pack-it-forms" && git checkout SF-ACS)
fi
for ADDON in SF_ACS_forms "$@"; do
    rm -rf   built/$ADDON
    mkdir -p built/$ADDON/addons                 || exit $?
    mkdir    built/$ADDON/bin                    || exit $?
    cp -p bin/*.ini bin/*.html built/$ADDON/bin/ || exit $?
    node bin/build.js build "$VersionMajor"."$VersionMinor"\
         "$ADDON" bin/$ADDON.js "PackItForms for Raspberry Pi"\
        || exit $?
    mv built/addons built/$ADDON/                || exit $?
    mv built/pi-browse.sh built/$ADDON/browse.sh || exit $?
    mv built/manual.html built/$ADDON/bin        || exit $?
    cp -p bin/server.js built/$ADDON/bin/$ADDON.js     || exit $?
    cp -p bin/commands.js bin/etc.js built/$ADDON/bin/ || exit $?
    cp -pr package.json node_modules built/$ADDON/bin/ || exit $?
    cp -p pi-UserGuide.html built/$ADDON/UserGuide.html || exit $?
    cp -pr pack-it-forms built/$ADDON/           || exit $?
    cp -p *.png built/$ADDON/pack-it-forms       || exit $?

    cd built/$ADDON                              || exit $?
    find . -type f -name "*~" | xargs rm -f
    rm -rf .git pack-it-forms/.git
    mv pack-it-forms/pdf .                       || exit $?
    rm pdf/LOS-ALTOS-*.pdf
    rm pack-it-forms/form-los-altos-*.html
    mv pack-it-forms/resources/integration/scco/$ADDON.launch addons/ || exit $?
    cd pack-it-forms/resources/integration       || exit $?
    mv scco/integration.js .                     || exit $?
    rm -r pacread scco                           || exit $?
    cd ../../..
    rm bin/cmd-convert.ini                       || exit $?
    node ../../bin/Outpost_Forms.js install wscript.exe || (cat logs/*-install.log; exit 1) || exit $?
    rm -r addons/$ADDON                          || exit $?
    rm bin/addon.ini bin/Aoclient.ini
    echo "$VersionMajor"."$VersionMinor" > version.txt
    chmod +x browse.sh bin/$ADDON.js bin/commands.js || exit $?
    cd ..
    rm -f "$ADDON"-*.tar.gz                      || exit $?
    tar -czf "$ADDON"-"$VersionMajor"."$VersionMinor".tar.gz $ADDON || exit $?
    cd ..
done
