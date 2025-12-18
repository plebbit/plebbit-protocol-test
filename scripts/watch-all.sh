#!/usr/bin/env bash

xterm -geometry "+0+0" -e "npm run test:watch" &
xterm -geometry "-0-0" -e "npm run test:server" &
sleep infinity
