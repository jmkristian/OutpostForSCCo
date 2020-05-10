#!/bin/bash
VersionMajor=2
VersionMinor=21b
cd `dirname "$0"` || exit $?
if [ ! -e node_modules ]; then
    # https://docs.npmjs.com/cli/install
    npm install                              || exit $?
fi
#if [ ! -e "pack-it-forms"/.git ]; then # Don't delete an experimental copy.
#    rm -rf "pack-it-forms"
#fi
if [ ! -e "pack-it-forms" ]; then
    git clone https://github.com/jmkristian/pack-it-forms.git || exit $?
    (cd "pack-it-forms" && git checkout vSCCo.30)
    rm -rf "pack-it-forms"/.git*
fi
rm -rf built/SCCoPIFR/*
mkdir -p built/SCCoPIFR/addons                  || exit $?
mkdir    built/SCCoPIFR/bin                     || exit $?
cp -p bin/*.ini bin/*.html built/SCCoPIFR/bin/  || exit $?
node bin/Outpost_Forms.js build "$VersionMajor"."$VersionMinor"\
   SCCoPIFO bin/SCCoPIFR.js "SCCo PackItForms for Raspberry Pi"\
                                                || exit $?
mv built/addons built/SCCoPIFR/                 || exit $?
mv built/pi-browse.sh built/SCCoPIFR/browse.sh  || exit $?
mv built/UserGuide.html built/SCCoPIFR/         || exit $?
cp -p bin/Outpost_Forms.js built/SCCoPIFR/bin/SCCoPIFR.js    || exit $?
cp -pr package.json node_modules built/SCCoPIFR/bin/         || exit $?
cp -pr pack-it-forms built/SCCoPIFR/         || exit $?
cp -p *.png built/SCCoPIFR/pack-it-forms     || exit $?

cd built/SCCoPIFR                            || exit $?
find . -type f -name "*~" | xargs rm
rm -rf .git
mv pack-it-forms/pdf .                       || exit $?
rm pdf/LOS-ALTOS-*.pdf
rm pack-it-forms/form-los-altos-*.html
mv pack-it-forms/resources/integration/scco/SCCoPIFO.launch addons/ || exit $?
cd pack-it-forms/resources/integration       || exit $?
mv scco/integration.js .                     || exit $?
rm -r pacread scco                           || exit $?
cd ../../..
rm bin/cmd-convert.ini                       || exit $?
node bin/SCCoPIFR.js install bin/SCCoPIFR.js || (cat logs/*-install.log; exit 2)
rm -r addons/SCCoPIFO                        || exit $?
rm bin/addon.ini bin/Aoclient.ini
echo "$VersionMajor"."$VersionMinor" > version.txt
chmod +x browse.sh bin/SCCoPIFR.js           || exit $?
cd ..
tar -czf SCCoPIFR.tar.gz SCCoPIFR            || exit $?
