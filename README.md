This repo contains extra tests for `plebbit-js` (https://github.com/plebbit/plebbit-js) to ensure no protocol regression.

#### Install

- `npm install`

#### Node tests

- `npm run test`

#### Watch node tests

- `npm run test:watch`

#### Install Playwright browsers (first run)

- `npx playwright install --with-deps chromium firefox`

#### Browser tests

- `npm run test:browser`

#### Tests with plebbit-js logs

```
DEBUG=plebbit-js:* npm run test
```
