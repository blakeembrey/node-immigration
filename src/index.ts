import fs = require('fs')
import ms = require('ms')
import thenify = require('thenify')
import { EventEmitter } from 'events'
import { resolve, join, extname, basename } from 'path'
import Promise = require('any-promise')
import tch = require('touch')
import arrify = require('arrify')
import { BaseError } from 'make-error-cause'
import pad = require('pad-left')
import resolveFrom = require('resolve-from')
import promiseFinally from 'promise-finally'

const touch = thenify(tch)
const readdir = thenify(fs.readdir)

export interface CreateOptions {
  name?: string
  directory?: string
  extension?: string
}

/**
 * Create a new migration file.
 */
export function create (options: CreateOptions = {}): Promise<void> {
  const dir = resolve(options.directory || 'migrations')
  const extension = options.extension || '.js'

  const date = new Date()
  const prefix = String(date.getUTCFullYear()) +
    pad(String(date.getUTCMonth() + 1), 2, '0') +
    pad(String(date.getUTCDate()), 2, '0') +
    pad(String(date.getUTCHours()), 2, '0') +
    pad(String(date.getUTCMinutes()), 2, '0') +
    pad(String(date.getUTCSeconds()), 2, '0')
  const suffix = options.name ? `_${options.name}` : ''

  return touch(join(dir, `${prefix}${suffix}${extension}`)).then(() => undefined)
}

export interface MigrateOptions {
  all?: boolean
  name?: string
  new?: boolean
  since?: string
  directory?: string
  retries?: number
  retryWait?: number
}

export interface TidyOptions {
  directory?: string
}

export class Migrate extends EventEmitter {

  constructor (public plugin?: Plugin) {
    super()
  }

  log (name: string, status: Status, date: Date) {
    return Promise.resolve(this.plugin ? this.plugin.log(name, status, date) : undefined)
      .then(() => {
        this.emit('log', name)
      })
  }

  unlog (name: string) {
    return Promise.resolve(this.plugin ? this.plugin.unlog(name) : undefined)
      .then(() => {
        this.emit('unlog', name)
      })
  }

  lock () {
    return Promise.resolve(this.plugin ? this.plugin.lock() : undefined)
  }

  unlock () {
    return Promise.resolve(this.plugin ? this.plugin.unlock() : undefined)
  }

  executed () {
    return Promise.resolve(this.plugin ? this.plugin.executed() : [])
  }

  tidy (options: TidyOptions = {}) {
    const path = resolve(options.directory || 'migrations')

    return Promise.all([list(path), this.executed()])
      .then(([files, executed]) => {
        const names = files.map(file => toName(file))

        return Promise.all(executed.map((execution) => {
          const exists = names.some(name => execution.name === name)

          if (!exists) {
            return this.unlog(execution.name)
          }

          return
        }))
      })
  }

  migrate (cmd: 'up' | 'down', options: MigrateOptions & ListOptions = {}) {
    const { name, count, begin, all, extension } = options

    if (!name && !count && !begin && !all) {
      if (this.plugin) {
        const opt = cmd === 'up' ? 'new' : 'since'

        if (!options.hasOwnProperty(opt)) {
          return Promise.reject<undefined>(
            new TypeError(`Requires "count", "begin", "all", "${opt}", or a migration name to run`)
          )
        }
      } else {
        return Promise.reject<undefined>(
          new TypeError(`Requires "count", "begin", "all", or a migration name to run`)
        )
      }
    }

    const path = resolve(options.directory || 'migrations')
    const since = typeof options.since === 'string' ? ms(options.since) : Infinity
    const retryWait = options.retryWait || 350
    let retries = options.retries || 5

    // Filter the list of files to only the ones we care about running.
    const filter = (files: string[], executed: Executed[]) => {
      return files.filter((file) => {
        const name = toName(file)
        const matches = executed.filter(x => x.name === name)

        if (cmd === 'up') {
          return options.new ? !matches.length : true
        }

        return matches.length ? matches.some(x => x.date.getTime() >= Date.now() - since) : true
      })
    }

    const exec = (file: string) => {
      const name = toName(file)
      const date = new Date()
      const m = require(join(path, file))
      const fn = m[cmd]

      // Skip missing up/down methods.
      if (fn == null) {
        this.emit('skipped', name)
        return
      }

      if (typeof fn !== 'function') {
        return Promise.reject<undefined>(
          new ImmigrationError(`Migration ${cmd} is not a function: ${name}`, undefined, path)
        )
      }

      this.emit('pending', name)

      return this.log(name, 'pending', date).then(() => run(fn))
        .then(
          () => {
            this.emit('done', name, Date.now() - date.getTime())

            return cmd === 'down' ? this.unlog(name) : this.log(name, 'done', date)
          },
          (error) => {
            this.emit('failed', name, Date.now() - date.getTime())

            return this.log(name, 'failed', date).then(() => {
              let message = `Migration ${cmd} failed on "${name}"`

              if (this.plugin) {
                message += '\nYou will need to "unlog" this migration before trying again'
              }

              return Promise.reject(new ImmigrationError(message, error, path))
            })
          }
        )
    }

    // Run the migration.
    const migrate = (files: string[], executed: Executed[]) => {
      // Check for bad migrations before proceeding.
      for (const execution of executed) {
        if (execution.status !== 'done') {
          return Promise.reject<undefined>(new ImmigrationError(
            `Another migration ("${execution.name}") appears to be in a "${execution.status}" state. ` +
            `Please verify your migration plugin has acquired a lock correctly`,
            undefined,
            path
          ))
        }
      }

      return filter(files, executed).reduce<Promise<any>>(
        (p, file) => p.then(() => exec(file)),
        Promise.resolve()
      )
    }

    // Make a migration attempt by skipping lock when possible.
    const attempt = (files: string[]) => {
      return this.executed()
        .then<undefined>((executed) => {
          // Check for bad migrations before proceeding.
          for (const execution of executed) {
            if (execution.status === 'failed') {
              return Promise.reject<undefined>(new ImmigrationError(
                `A previously executed migration ("${execution.name}") is in a "${execution.status}" state. ` +
                `Please "unlog" to mark as resolved before continuing`,
                undefined,
                path
              ))
            }
          }

          const pending = filter(files, executed)

          // Skip the lock and migration step when there's no pending migrations.
          if (!pending.length) {
            return
          }

          const promise = this.lock()
            .then(() => this.executed())
            .then((executed) => migrate(files, executed))

          return promiseFinally(promise, () => this.unlock())
            .catch((error) => {
              // Allow lock retries. This is useful as we will re-attempt which
              // may no longer require any migrations to lock to run.
              if (error instanceof LockRetryError && retries-- > 0) {
                return new Promise((resolve) => {
                  this.emit('retry', retries)

                  setTimeout(() => resolve(attempt(files)), retryWait)
                })
              }

              return Promise.reject<undefined>(error)
            })
        })
    }

    return list(path, { reverse: cmd === 'down', name, begin, count, extension })
      .then((files) => attempt(files))
  }

}

/**
 * Get the name from a path.
 */
export function toName (path: string): string {
  return basename(path).replace(/\.[^\.]+$/, '')
}

/**
 * Expose options.
 */
export interface ListOptions {
  name?: string
  begin?: string
  count?: number
  extension?: string | string[]
  reverse?: boolean
}

/**
 * List available files.
 */
export function list (path: string, options: ListOptions = {}): Promise<string[]> {
  const extensions = arrify(options.extension)

  if (extensions.length === 0) {
    extensions.push('.js')
  }

  return readdir(path)
    // Reverse the list.
    .then(files => {
      return options.reverse ? files.reverse() : files
    })
    // Filter by name and supported extensions.
    .then(files => {
      if (options.name) {
        files = files.filter(filename => toName(filename) === options.name)
      }

      return files.filter(filename => extensions.indexOf(extname(filename)) > -1).sort()
    })
    // Support "begin" option.
    .then(files => {
      if (options.begin) {
        let begin = 0

        for (const filename of files) {
          if (toName(filename) === options.begin) {
            break
          }

          begin++
        }

        return files.slice(begin)
      }

      return files
    })
    // Support "count" option.
    .then(files => {
      if (options.count) {
        return files.slice(-options.count)
      }

      return files
    })
}

/**
 * Initialize an instance of a plugin.
 */
export function createPlugin (options: PluginOptions, cwd: string): Plugin {
  const name = options._[0]
  const path = resolveFrom(cwd, name)

  if (!path) {
    throw new TypeError(`Unable to require("${name}")`)
  }

  const plugin: PluginModule = require(path)

  return plugin.init(options, cwd)
}

/**
 * Execute a function with callback support.
 */
function run (fn: (cb?: (err?: any) => any) => any): Promise<any> {
  if (fn.length === 1) {
    fn = thenify(fn)
  }

  // Handle errors thrown by `fn`.
  return new Promise(resolve => resolve(fn()))
}

/**
 * Errors caused during migration.
 */
export class ImmigrationError extends BaseError {
  name = 'ImmigrationError'

  constructor (msg: string, cause?: Error, public path?: string) {
    super(msg, cause)
  }
}

/**
 * Create a "retry lock" error.
 */
export class LockRetryError extends BaseError {
  name = 'LockRetryError'
}

/**
 * What a execution looks like.
 */
export interface Executed {
  name: string
  status: Status
  date: Date
}

/**
 * Plugin options is from `subarg`.
 */
export interface PluginOptions {
  _: string[]
  [key: string]: any
}

/**
 * The plugin only needs to export a single `init` option.
 */
export interface PluginModule {
  init (options: PluginOptions, directory: string): Plugin
}

/**
 * Current migration status.
 */
export type Status = 'pending' | 'failed' | 'done'

/**
 * Expose the required methods for migration.
 */
export interface Plugin {
  executed (): Promise<Executed[]>
  lock (): Promise<any>
  unlock (): Promise<any>
  log (name: string, status: Status, date: Date): Promise<any>
  unlog (name: string): Promise<any>
}
