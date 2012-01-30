#!/bin/sh

PWD=`pwd`
export NODE_PATH="$PWD"
mkdir -p /var/log/immortal

echo 'Starting immortal'
rm -f /var/log/immortal/immortal.$2.log
exec /opt/node/current/bin/node immortal2.js $1 >> /var/log/immortal/immortal.$2.log 2>&1 &
