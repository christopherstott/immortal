killall node
rm /var/log/immortal/immortal.test.log
./immortal.sh ./test/test.json test
tail -f -n 100 /var/log/immortal/immortal.test.log