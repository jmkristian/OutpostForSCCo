#!/bin/bash
# Build an installer for one add-on for Outpost PMM.
# $1 = the add-on name
# $2 = the display name of the add-on
# $3 = the name of the HTTP server.exe (not including its folder name)
# $4 = the name of the installer.exe (not including its folder name)

rm -rf built/addons built/bin
mkdir -p built/addons built/bin built/webToPDF || exit $?
node ./buildInstaller.js "$VersionMajor.$VersionMinor$VersionBeta" "$1" "$2" "$3" || exit $?
cp -p webToPDF/built/WebToPDF.exe built/webToPDF/WebToPDF.exe
cp -p "$FORMS"/resources/integration/scco/"$1".nsi built/addon.nsi || exit $?
cp -p "$FORMS"/resources/integration/scco/"$1".launch built/addons || exit $?
./setup.cmd "$1" "$2" "bin\\$3" "$4" || exit $?
