#!/usr/bin/env bash

xterm -geometry "+0+0" -e "yarn webpack:watch" &
xterm -geometry "-0-0" -e "yarn test:server" &
sleep infinity
