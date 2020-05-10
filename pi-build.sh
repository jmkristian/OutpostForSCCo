#!/bin/bash
VersionMajor=2
VersionMinor=21b
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
    rm -rf "pack-it-forms"/.git*
fi
for ADDON in SCCoPIFO SF_ACS_forms "$@"; do
    rm -rf   built/$ADDON/*
    mkdir -p built/$ADDON/addons                 || exit $?
    mkdir    built/$ADDON/bin                    || exit $?
    cp -p bin/*.ini bin/*.html built/$ADDON/bin/ || exit $?
    node bin/Outpost_Forms.js build "$VersionMajor"."$VersionMinor"\
         "$ADDON" bin/$ADDON.js "PackItForms for Raspberry Pi"\
        || exit $?
    mv built/addons built/$ADDON/                || exit $?
    mv built/pi-browse.sh built/$ADDON/browse.sh || exit $?
    mv built/UserGuide.html built/$ADDON/        || exit $?
    mv built/manual.html built/$ADDON/bin        || exit $?
    cp -p bin/Outpost_Forms.js built/$ADDON/bin/$ADDON.js  || exit $?
    cp -pr package.json node_modules built/$ADDON/bin/     || exit $?
    cp -pr pack-it-forms built/$ADDON/           || exit $?
    cp -p *.png built/$ADDON/pack-it-forms       || exit $?

    cd built/$ADDON                              || exit $?
    find . -type f -name "*~" | xargs rm
    rm -rf .git
    mv pack-it-forms/pdf .                       || exit $?
    rm pdf/LOS-ALTOS-*.pdf
    rm pack-it-forms/form-los-altos-*.html
    mv pack-it-forms/resources/integration/scco/$ADDON.launch addons/ || exit $?
    cd pack-it-forms/resources/integration       || exit $?
    mv scco/integration.js .                     || exit $?
    rm -r pacread scco                           || exit $?
    cd ../../..
    rm bin/cmd-convert.ini                       || exit $?
    node bin/$ADDON.js install bin/$ADDON.js || (cat logs/*-install.log; exit 1) || exit $?
    rm -r addons/$ADDON                          || exit $?
    rm bin/addon.ini bin/Aoclient.ini
    echo "$VersionMajor"."$VersionMinor" > version.txt
    chmod +x browse.sh bin/$ADDON.js             || exit $?
    cd ..
    tar -czf $ADDON.tar.gz $ADDON                || exit $?
    cd ..
done
