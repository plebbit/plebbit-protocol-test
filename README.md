This repo contains extra tests for the plebbit protocol ((https://github.com/plebbit/plebbit-js) to ensure no protocol regression.

#### Install

- `yarn`

#### Node tests

- `yarn test`

#### Bundle browser tests in watch mode

- `yarn webpack:watch`

#### Browser tests

- `yarn test:browser`

#### Tests with plebbit-js logs

```
DEBUG=plebbit-js:* yarn test
```
