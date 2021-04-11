# Immigration

[![NPM version][npm-image]][npm-url]
[![NPM downloads][downloads-image]][downloads-url]
[![Build status][build-image]][build-url]
[![Build coverage][coverage-image]][coverage-url]

> Simple, no-frills migration utility.

## Installation

```sh
npm install -g immigration
```

## Usage

From `immigration --help`:

```
immigration [options] [command]

Options:
  --store [plugin]    Loads a plugin for state storage (default: "fs")
  --directory [dir]   Directory to read migrations from
  --extension [ext]   Specify the default extension to support

Commands:
  up        Run up migration scripts
  down      Run down migration scripts
  create    Create a new migration file
  list      List available migrations
  history   List the run migrations
  force     Force a migration to be valid
  remove    Remove a migration
```

Migration files should export two functions: `up` and `down`. These functions can return a promise for asynchronous actions.

## License

Apache 2.0

[npm-image]: https://img.shields.io/npm/v/immigration
[npm-url]: https://npmjs.org/package/immigration
[downloads-image]: https://img.shields.io/npm/dm/immigration
[downloads-url]: https://npmjs.org/package/immigration
[build-image]: https://img.shields.io/github/workflow/status/blakeembrey/node-immigration/CI/main
[build-url]: https://github.com/blakeembrey/node-immigration/actions/workflows/ci.yml?query=branch%3Amain
[coverage-image]: https://img.shields.io/codecov/c/gh/blakeembrey/node-immigration
[coverage-url]: https://codecov.io/gh/blakeembrey/node-immigration
