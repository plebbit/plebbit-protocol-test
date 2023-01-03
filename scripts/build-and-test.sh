#!/usr/bin/env bash

# close test server
kill `pgrep --full  'node test/test-server'`
# close ipfs daemons
kill `pgrep --full  'ipfs daemon'`

# build and bundle
yarn
yarn webpack

# wait until test server is ready
yarn test:server & yarn test:server:wait-on

# tests
yarn test
CHROME_BIN=$(which chrome || which chromium) FIREFOX_BIN=$(which firefox) yarn test:browser

# close test server
kill `pgrep --full  'node test/test-server'`
# close ipfs daemons
kill `pgrep --full  'ipfs daemon'`
