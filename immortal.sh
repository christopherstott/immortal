#!/bin/sh

mkdir -p /var/log/immortal

echo 'Killing previous node instances'
killall node
echo 'Starting immortal'
rm /var/log/immortal/immortal.log
exec /opt/node/current/bin/node immortal.js >> /var/log/immortal/immortal.log 2>&1 &