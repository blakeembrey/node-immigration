# Immigration

[![Greenkeeper badge](https://badges.greenkeeper.io/blakeembrey/node-immigration.svg)](https://greenkeeper.io/)

[![NPM version][npm-image]][npm-url]
[![NPM downloads][downloads-image]][downloads-url]
[![Build status][travis-image]][travis-url]
[![Test coverage][coveralls-image]][coveralls-url]

> Simple, no-frills migration utility.

## Installation

```sh
npm install -g immigration
```

## Usage

From `immigration --help`:

```
immigration [command] [options]

Options:
  -d, --directory [dir]  The path to migration scripts
  -b, --begin [name]     First script to begin on
  -c, --count [num]      The number of migrations to execute (default: all)
  -e, --extension [ext]  Supported file extensions (default: ".js")
  -a, --all              Explicitly execute all migrations (execute without count or begin)
  -n, --new              Execute the new migrations (used for "up" migrations) *
  -s, --since            Rollback migrations for duration (E.g. "30m") (used for "down" migrations) *

Commands:
  up [name]       Run up migration scripts
  down [name]     Run down migration scripts
  create [title]  Create a new migration file
  list            List available migrations
  executed        List the run migrations *
  log [name]      Mark a migration as run (without explicitly executing up) *
  unlog [name]    Remove a migration marked as run (without explicitly executing down) *
  tidy            Unlog unknown migration names *

* Requires adapter (E.g. "--use [ immigration/fs ]")
```

Migrations can export two functions: `up` and `down`. These functions can accept a callback or return a promise for asynchronous actions, such as altering a database.

### Adapters

Adapters can be used with `immigration` for persistence of migration state. The built-in adapter is `fs`, but others can be created. The only requirement is that they export function called `init` which, when called, returns an object with `isLocked`, `executed`, `lock`, `unlock`, `log` and `unlog` functions.

* [`fs`](https://github.com/blakeembrey/node-immigration/blob/master/src/fs.ts) - Built-in adapter persisting to a JSON file
* [`rethinkdb`](https://github.com/blakeembrey/node-immigration-rethinkdb) - Adapter for RethinkDB persistence

### CLI

```
immigration up -a
immigration down -c1
```

## Attribution

Loosely based on Rails and [node-migrate](https://github.com/tj/node-migrate), but I tried to keep the implementation simpler and more configurable.

## License

Apache 2.0

[npm-image]: https://img.shields.io/npm/v/immigration.svg?style=flat
[npm-url]: https://npmjs.org/package/immigration
[downloads-image]: https://img.shields.io/npm/dm/immigration.svg?style=flat
[downloads-url]: https://npmjs.org/package/immigration
[travis-image]: https://img.shields.io/travis/blakeembrey/node-immigration.svg?style=flat
[travis-url]: https://travis-ci.org/blakeembrey/node-immigration
[coveralls-image]: https://img.shields.io/coveralls/blakeembrey/node-immigration.svg?style=flat
[coveralls-url]: https://coveralls.io/r/blakeembrey/node-immigration?branch=master
