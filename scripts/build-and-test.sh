#!/usr/bin/env bash

# close test server
kill `pgrep --full  'node test/test-server'`
# close ipfs daemons
kill `pgrep --full  'ipfs daemon'`

# build and bundle
yarn
npx playwright install --with-deps chromium firefox

# wait until test server is ready
yarn test:server & yarn test:server:wait-on

# tests
yarn test
yarn test:browser

# close test server
kill `pgrep --full  'node test/test-server'`
# close ipfs daemons
kill `pgrep --full  'ipfs daemon'`
