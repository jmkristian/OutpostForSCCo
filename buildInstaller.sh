#!/bin/bash
# Build an installer for one add-on for Outpost PMM.
# $1 = the add-on name
# $2 = the display name of the add-on
# $3 = the name of the HTTP server.exe (not including its folder name)
# $4 = the name of the installer.exe (not including its folder name)

rm -rf built/addons
mkdir -p built/addons || exit $?
node bin/Outpost_Forms.js build $VersionMajor.$VersionMinor $VersionPatch "$1" bin\\"$3" "$2" || exit $?
cp -p "$FORMS"/resources/integration/scco/"$1".nsi built/addon.nsi || exit $?
./setup.cmd "$1" "$2" "bin\\$3" "$4" || exit $?
