# Immigration

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

Only three commands and various config options. Created to run migration scripts without any boilerplate.

```
immigration [command] [options]

Options:
  -d, --directory [dir]  The path to migration scripts
  -b, --begin [name]     First script to begin on
  -c, --count [num]      The number of migrations to execute (default: all)
  -e, --extension [ext]  Supported file extensions (default: ".js")
  -a, --all              Explicitly execute all migrations (execute without count or begin)

Commands:
  up [name]       Migrate up
  down [name]     Migrate down
  create [title]  Create a new migration file
  list            List available migrations
```

Migrations can export two functions: `up` and `down`. These functions can accept a callback or return a promise for asynchronous actions, such as altering a database.

### CLI

```
immigration up -a
immigration down -c 1
```

## Attribution

Loosely based on Rails and [node-migrate](https://github.com/tj/node-migrate), but purposely missing complexity that didn't work for my own deployments (E.g. writing to file for state).

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
