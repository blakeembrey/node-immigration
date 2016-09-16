#!/usr/bin/env node

import minimist = require('minimist')
import extend = require('xtend')
import arrify = require('arrify')
import immigration = require('./index')

interface Argv {
  begin?: string
  directory?: string
  count?: number
  extension?: string | string[]
  all?: boolean
  help?: boolean
}

const argv = minimist<Argv>(process.argv.slice(2), {
  string: ['begin', 'directory', 'extension'],
  boolean: ['help', 'all'],
  alias: {
    d: ['directory'],
    b: ['begin'],
    c: ['count'],
    e: ['extension'],
    a: ['all'],
    h: ['help']
  }
})

if (argv.help || argv._.length === 0) {
  console.error(`
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
`)

  process.exit(argv.help ? 0 : 1)
}

immigration(argv._[0], argv._[1], {
  begin: arrify(argv.begin).pop(),
  directory: arrify(argv.directory).pop(),
  extension: arrify(argv.extension),
  all: !!argv.all,
  log: true
})
  .then(
    () => process.exit(0),
    () => process.exit(1)
  )
