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
    reverse?: boolean
    all?: boolean
    new?: boolean
    plan?: boolean
    help?: boolean
    since?: string
    use?: immigration.PluginOptions
  }

  const argv = subarg<Argv>(process.argv.slice(2), {
    string: ['begin', 'directory', 'extension', 'since'],
    boolean: ['help', 'all', 'new', 'reverse', 'plan'],
    alias: {
      u: ['use'],
      p: ['plan'],
      d: ['directory'],
      b: ['begin'],
      c: ['count'],
      e: ['extension'],
      a: ['all'],
      n: ['new'],
      h: ['help'],
      s: ['since'],
      r: ['reverse']
    }
  })

  const cmd = argv._[0]
  const name = argv._[1] as string | undefined
  const directory = resolve(arrify(argv.directory).pop() || 'migrations')

  const options: immigration.ListOptions & immigration.PlanOptions & immigration.MigrateOptions = {
    all: argv.all,
    plan: argv.plan,
    name: name,
    new: argv.new,
    since: argv.since,
    begin: argv.begin,
    count: argv.count,
    reverse: argv.reverse,
    extension: argv.extension
  }

  const plugin = argv.use ? immigration.createPlugin(argv.use, process.cwd()) : undefined
  const migrate = new immigration.Migrate(plugin, directory)

  migrate.on('skipped', function (name: string) {
    console.log(`${chalk.cyan('-')} ${name}`)
  })

  migrate.on('planned', function (name: string) {
    console.log(`${chalk.yellow('○')} ${name} (planned)`)
  })

  migrate.on('log', function (name: string) {
    console.log(`${chalk.green('✔')} ${name} (logged)`)
  })

  migrate.on('unlog', function (name: string) {
    console.log(`${chalk.green('✔')} ${name} (unlogged)`)
  })

  migrate.on('pending', function (name: string) {
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

  migrate.on('retry', function (count: number) {
    logUpdate(`${chalk.yellow('…')} Attempting to acquire lock (${count})`)
  })

  // Generate the migration function.
  function migration (direction: 'up' | 'down') {
    return migrate.migrate(direction, options)
      .then((migrations) => {
        if (migrations.length) {
          console.log(`\n${chalk.green('✔')} Migration completed`)
        } else {
          console.log(`${chalk.yellow('…')} No migration required`)
        }
      })
  }

  // Create the executed list function.
  function executed () {
    return migrate.executed()
      .then((executed) => {
        for (const execution of executed) {
          console.log(
            `${chalk.cyan('•')} ${execution.name} ${execution.status} @ ` +
            `${chalk.magenta(execution.date.toLocaleString())}`
          )
        }
      })
  }

  // Log a migration as done.
  function log () {
    return migrate.log(options, 'done')
  }

  // Unlog a migration status.
  function unlog () {
    return migrate.unlog(options)
  }

  // Tidy up missing migrations from the plugin.
  function tidy () {
    return migrate.tidy()
      .then((tidied) => console.log(`Tidied ${tidied.length} ${tidied.length === 1 ? 'migration' : 'migrations'}`))
  }

  // Remove the current migration lock.
  function unlock () {
    return migrate.unlock()
      .then(() => console.log(`Migration state unlocked`))
  }

  // Check if the migration is locked.
  function locked () {
    return migrate.isLocked()
      .then((locked) => console.log(`State: ${locked ? 'locked' : 'unlocked'}`))
  }

  // List available migrations.
  function list () {
    return migrate.list(options)
      .then((paths) => {
        for (const path of paths) {
          console.log(`${chalk.cyan('•')} ${immigration.toName(path)}`)
        }
      })
  }

  // Create a new migration file.
  function create () {
    return immigration.create({
      name: name,
      directory: migrate.directory,
      extension: arrify(options.extension).pop()
    })
      .then(() => console.log(`${chalk.green('✔')} File created`))
  }

  const commands: { [cmd: string]: () => any } = {
    create,
    list,
    executed,
    log,
    unlog,
    tidy,
    unlock,
    locked,
    up: () => migration('up'),
    down: () => migration('down')
  }

  if (commands.hasOwnProperty(cmd as string)) {
    return commands[cmd as string]()
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
  -p, --plan             Execute a dry-run of the migration to verify plan

Commands:
  up [name]       Run up migration scripts
  down [name]     Run down migration scripts
  create [title]  Create a new migration file
  list            List available migrations
  executed        List the run migrations *
  log [name]      Mark a migration as run (without executing up) *
  unlog [name]    Remove a migration marked as run (without executing down) *
  tidy            Unlogs unknown migrations from the plugin *

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
        console.error(`${chalk.red('Caused by:')}`, error.cause.stack || error.cause)
      }
    } else {
      console.error(error.stack || error)
    }

    process.exit(1)
  })
