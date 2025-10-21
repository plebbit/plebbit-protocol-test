This repo contains extra tests for `plebbit-js` (https://github.com/plebbit/plebbit-js) to ensure no protocol regression.

#### Install

- `yarn`

#### Node tests

- `yarn test`

#### Watch node tests

- `yarn test:watch`

#### Install Playwright browsers (first run)

- `npx playwright install --with-deps chromium firefox`

#### Browser tests

- `yarn test:browser`

#### Tests with plebbit-js logs

```
DEBUG=plebbit-js:* yarn test
```
