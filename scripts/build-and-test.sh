#!/usr/bin/env bash

# close test server
kill `pgrep --full  'node test/test-server'`
# close ipfs daemons
kill `pgrep --full  'ipfs daemon'`

# build and bundle
npm install
npx playwright install --with-deps chromium firefox

# wait until test server is ready
npm run test:server & npm run test:server:wait-on

# tests
npm run test
npm run test:browser

# close test server
kill `pgrep --full  'node test/test-server'`
# close ipfs daemons
kill `pgrep --full  'ipfs daemon'`
