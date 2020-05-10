#!/bin/sh
# Open a browser page via which you can create or view forms.
cd `dirname "$0"`
{{PROGRAM_PATH}} dry-run {{PROGRAM_PATH}} || exit $?
SERVER_PORT=`cat logs/server-port.txt`
echo       chromium-browser http://127.0.0.1:$SERVER_PORT/manual
DISPLAY=:0 chromium-browser http://127.0.0.1:$SERVER_PORT/manual\
    | fgrep -v "FontService unique font name matching request did not receive a response."\
    || exit $?
