#!/bin/sh
PWD=`pwd`
export NODE_PATH="$PWD"

echo 'Killing previous node instances'
killall node
echo 'Starting immortal'
/opt/node/current/bin/node immortal.js $1