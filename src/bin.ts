#!/usr/bin/env node

import subarg = require('subarg')
import arrify = require('arrify')
import chalk = require('chalk')
import Promise = require('any-promise')
import ms = require('ms')
import { resolve } from 'path'
import logUpdate = require('log-update')
import * as immigration from './index'

function run (): Promise<any> {
  interface Argv {
    begin?: string
    directory?: string
    count?: number
    extension?: string | string[]
    all?: boolean
    new?: boolean
    help?: boolean
    since?: string
    use?: immigration.PluginOptions
  }

  const argv = subarg<Argv>(process.argv.slice(2), {
    string: ['begin', 'directory', 'extension', 'since'],
    boolean: ['help', 'all', 'new'],
    alias: {
      u: ['use'],
      d: ['directory'],
      b: ['begin'],
      c: ['count'],
      e: ['extension'],
      a: ['all'],
      n: ['new'],
      h: ['help'],
      s: ['since']
    }
  })

  const cmd = argv._[0]
  const name = argv._[1] as string | undefined

  if (cmd === 'create') {
    return immigration.create({
      name: name,
      directory: argv.directory,
      extension: arrify(argv.extension).pop()
    })
      .then(() => console.log(`${chalk.green('✔')} File created`))
  }

  if (cmd === 'list') {
    return immigration.list(resolve(argv.directory || 'migrations'))
      .then((paths) => {
        for (const path of paths) {
          console.log(`${chalk.cyan('•')} ${immigration.toName(path)}`)
        }
      })
  }

  if (cmd === 'up' || cmd === 'down' || cmd === 'executed' || cmd === 'log' || cmd === 'unlog' || cmd === 'tidy') {
    const plugin = argv.use ? immigration.createPlugin(argv.use, process.cwd()) : undefined
    const migrate = new immigration.Migrate(plugin)
    let migrations = 0

    migrate.on('skipped', function (name: string) {
      console.log(`${chalk.cyan('-')} ${name}`)
    })

    migrate.on('pending', function (name: string) {
      migrations++

      logUpdate(`${chalk.yellow('○')} ${name}`)
    })

    migrate.on('done', function (name: string, duration: number) {
      logUpdate(`${chalk.green('✔')} ${name} ${chalk.magenta(ms(duration))}`)
      logUpdate.done()
    })

    migrate.on('failed', function (name: string, duration: number) {
      logUpdate(`${chalk.red('⨯')} ${name} ${chalk.magenta(ms(duration))}`)
      logUpdate.done()
    })

    if (cmd === 'up' || cmd === 'down') {
      return migrate.migrate(cmd as 'up' | 'down', {
        all: argv.all,
        name: name,
        new: argv.new,
        since: argv.since,
        directory: argv.directory,
        begin: argv.begin,
        count: argv.count,
        extension: argv.extension
      })
        .then(() => {
          if (migrations > 0) {
            console.log(`\n${chalk.green('✔')} Migrations ran successfully`)
          } else {
            console.log(`${chalk.yellow('○')} No migrations executed`)
          }
        })
    }

    if (!plugin) {
      throw new TypeError(`This command requires a plugin to be specified`)
    }

    if (cmd === 'executed') {
      return migrate.executed()
        .then((executed) => {
          for (const execution of executed) {
            console.log(
              `${chalk.cyan('•')} ${execution.name} ${execution.status} @ ` +
              `${chalk.magenta(execution.date.toISOString())}`
            )
          }
        })
    }

    if (cmd === 'log') {
      if (!name) {
        throw new TypeError(`Requires the migration name to "log"`)
      }

      return migrate.log(name, 'done', new Date())
        .then(() => console.log(`${chalk.green('✔')} Migration logged`))
    }

    if (cmd === 'unlog') {
      if (!name) {
        throw new TypeError(`Requires the migration name to "unlog"`)
      }

      return migrate.unlog(name)
        .then(() => console.log(`${chalk.green('✔')} Migration cleared`))
    }

    if (cmd === 'tidy') {
      return migrate.tidy()
        .then(() => console.log(`${chalk.green('✔')} Migrations tidied`))
    }
  }

  console.error(`
immigration [command] [options]

Options:
  -d, --directory [dir]  The path to migration scripts
  -b, --begin [name]     First script to begin on
  -c, --count [num]      The number of migrations to execute (default: all)
  -e, --extension [ext]  Supported file extensions (default: ".js")
  -a, --all              Explicitly execute all migrations (execute without count or begin)
  -n, --new              Execute the new migrations (used for "up" migrations) *
  -s, --since            Rollback migrations for duration (E.g. "30m") (used for "down" migrations) *
  -u, --use              Require a plugin and pass configuration options

Commands:
  up [name]       Run up migration scripts
  down [name]     Run down migration scripts
  create [title]  Create a new migration file
  list            List available migrations
  executed        List the run migrations *
  log [name]      Mark a migration as run (without explicitly executing up) *
  unlog [name]    Remove a migration marked as run (without explicitly executing down) *
  tidy            Unlog unknown migration names from the plugin *

* Requires plugin (E.g. "--use [ immigration/fs ]")
`)

  return Promise.resolve(process.exit(argv.help ? 0 : 1))
}

// Remember to force process termination after migration.
run()
  .then(() => process.exit(0))
  .catch((error) => {
    if (error instanceof immigration.ImmigrationError) {
      console.error(`${chalk.red('⨯')} ${error.message} ${error.path ? `(${error.path})` : ''}`)

      if (error.cause) {
        console.error(error.cause.stack || error.cause)
      }
    } else {
      console.error(error.stack || error)
    }

    process.exit(1)
  })
