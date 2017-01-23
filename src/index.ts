import fs = require('fs')
import ms = require('ms')
import thenify = require('thenify')
import now = require('performance-now')
import { EventEmitter } from 'events'
import { resolve, join, extname, basename } from 'path'
import Promise = require('any-promise')
import tch = require('touch')
import arrify = require('arrify')
import { BaseError } from 'make-error-cause'
import pad = require('pad-left')
import resolveFrom = require('resolve-from')
import promiseFinally from 'promise-finally'

const touch = thenify<string, void>(tch)
const readdir = thenify<string, string[]>(fs.readdir)

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

/**
 * Migration options.
 */
export interface MigrateOptions {
  all?: boolean
  new?: boolean
  since?: string
}

/**
 * Lock acquisition options.
 */
export interface AcquireOptions {
  retries?: number
  retryWait?: number
}

/**
 * Enable "dry-runs" of commands.
 */
export interface PlanOptions {
  plan?: boolean
}

export class Migrate extends EventEmitter {

  constructor (public plugin?: Plugin, public directory: string = 'migrations') {
    super()
  }

  log (options: ListOptions & PlanOptions = {}, status: Status): Promise<string[] | undefined> {
    const date = new Date()

    return this.list(options).then(files => {
      return this.acquire(
        () => {
          return Promise.all(files.map(file => {
            const name = toName(file)

            return this._log(name, status, date)
              .then(() => {
                this.emit('log', name)
                return name
              })
          }))
        },
        () => {
          if (options.plan) {
            files.forEach(file => this.emit('planned', toName(file)))

            return false
          }

          return files.length > 0
        }
      )
    })
  }

  _log (name: string, status: Status, date: Date): Promise<void> {
    return Promise.resolve(this.plugin ? this.plugin.log(name, status, date) : undefined)
  }

  unlog (options: ListOptions & PlanOptions & AcquireOptions = {}): Promise<string[] | undefined> {
    return this.list(options).then(files => {
      return this.acquire(
        () => {
          return Promise.all(files.map(file => {
            const name = toName(file)

            return this._unlog(name)
              .then(() => {
                this.emit('unlog', name)
                return name
              })
          }))
        },
        () => {
          if (options.plan) {
            files.forEach(file => this.emit('planned', toName(file)))

            return false
          }

          return files.length > 0
        },
        options
      )
    })
  }

  _unlog (name: string): Promise<void> {
    return Promise.resolve(this.plugin ? this.plugin.unlog(name) : undefined)
  }

  lock () {
    return Promise.resolve(this.plugin ? this.plugin.lock() : undefined)
  }

  unlock () {
    return Promise.resolve(this.plugin ? this.plugin.unlock() : undefined)
  }

  isLocked () {
    return Promise.resolve(this.plugin ? this.plugin.isLocked() : false)
  }

  executed () {
    return Promise.resolve(this.plugin ? this.plugin.executed() : [])
      .then(x => x.sort((a, b) => a.date.getTime() - b.date.getTime()))
  }

  tidy (options: PlanOptions & AcquireOptions = {}): Promise<string[] | undefined> {
    const filter = (files: string[], executed: Executed[]) => {
      const names = files.map(x => toName(x))

      return executed.map(x => x.name).filter(x => names.indexOf(x) === -1)
    }

    return this.list().then(files => {
      return this.acquire(
        () => {
          return this.executed().then((executed) => {
            const missing = filter(files, executed)

            return Promise.all(missing.map(name => {
              return this._unlog(name).then(() => name)
            }))
          })
        },
        () => {
          return this.executed().then((executed) => {
            const missing = filter(files, executed)

            if (options.plan) {
              missing.forEach(name => this.emit('planned', name))

              return false
            }

            return missing.length > 0
          })
        },
        options
      )
    })
  }

  migrate (
    cmd: 'up' | 'down',
    options: MigrateOptions & PlanOptions & ListOptions & AcquireOptions = {}
  ): Promise<string[] | undefined> {
    const { name, count, begin, extension } = options

    const all = !!options.all || (cmd === 'down' ? !!options.since : !!options.new)
    const since = typeof options.since === 'string' ? ms(options.since) : undefined

    // Run an execution.
    const exec = (file: string) => {
      const start = now()
      const date = new Date()
      const name = toName(file)
      const m = require(join(this.directory, file))
      const fn = m[cmd]

      // Skip missing up/down methods.
      if (fn == null) {
        this.emit('skipped', name)
        return
      }

      if (typeof fn !== 'function') {
        return Promise.reject<void>(
          new ImmigrationError(`Migration ${cmd} is not a function: ${name}`, undefined, this.directory)
        )
      }

      this.emit('pending', name)

      return this._log(name, 'pending', date).then(() => run(fn))
        .then(
          () => {
            this.emit('done', name, now() - start)

            return cmd === 'down' ? this._unlog(name) : this._log(name, 'done', date)
          },
          (error) => {
            this.emit('failed', name, now() - start)

            return this._log(name, 'failed', date).then(() => {
              let message = `Migration ${cmd} failed on "${name}"`

              if (this.plugin) {
                message += '\nYou will need to "unlog" this migration before trying again'
              }

              return Promise.reject(new ImmigrationError(message, error, this.directory))
            })
          }
        )
    }

    // Filter the list of files to only the ones we care about running.
    const filter = (files: string[], executed: Executed[]) => {
      return files.filter((file) => {
        const name = toName(file)
        const matches = executed.filter(x => x.name === name)

        if (cmd === 'up') {
          return options.new ? !matches.length : true
        }

        return since == null ? true : matches.some(x => x.date.getTime() >= Date.now() - since)
      })
    }

    const migrate = (files: string[], executed: Executed[]) => {
      // Check for bad migrations before proceeding.
      for (const execution of executed) {
        if (execution.status === 'pending') {
          return Promise.reject<string[]>(new ImmigrationError(
            `Another migration ("${execution.name}") appears to be in a "${execution.status}" state. ` +
            `Please verify your migration plugin has acquired a lock correctly`,
            undefined,
            this.directory
          ))
        }
      }

      const migrations = filter(files, executed)

      return migrations.reduce<Promise<any>>(
        (p, file) => p.then<any>(() => exec(file)),
        Promise.resolve()
      ).then(() => migrations)
    }

    return this.list({ reverse: cmd === 'down', all, name, begin, count, extension })
      .then((files) => {
        return this.acquire(
          () => this.executed().then((executed) => migrate(files, executed)),
          () => {
            return this.executed().then((executed) => {
              // Check for bad migrations before proceeding.
              for (const execution of executed) {
                if (execution.status === 'failed') {
                  return Promise.reject<boolean>(new ImmigrationError(
                    `A migration ("${execution.name}") is in a "${execution.status}" state. ` +
                    `Please "unlog" to mark as resolved before continuing`,
                    undefined,
                    this.directory
                  ))
                }
              }

              const pending = filter(files, executed)

              if (options.plan) {
                for (const file of pending) {
                  this.emit('planned', toName(file))
                }

                return false
              }

              return pending.length > 0
            })
          },
          options
        )
      })
  }

  acquire <T> (
    fn: () => Promise<T>,
    shouldRetry: () => Promise<boolean> | boolean,
    options: AcquireOptions = {}
  ): Promise<T | undefined> {
    const retries = options.retries || 10
    const retryWait = options.retryWait || 350

    const attempt = (count: number) => {
      const p = new Promise<boolean>(resolve => resolve(shouldRetry()))

      return p.then<T | Promise<T> | undefined>((retry) => {
        if (!retry) {
          return
        }

        return this.lock().then(() => {
          const p = new Promise(resolve => resolve(fn()))

          return promiseFinally(p, () => this.unlock())
            .catch((error) => {
              // Allow lock retries. This is useful as we will re-attempt which
              // may no longer require any migrations to lock to run.
              if (error instanceof LockRetryError && count < retries) {
                return new Promise((resolve) => {
                  this.emit('retry', count + 1, retries)

                  setTimeout(() => resolve(attempt(count + 1)), retryWait)
                })
              }

              return Promise.reject<T>(error)
            })
        })
      })
    }

    return attempt(0)
  }

  list (options?: ListOptions) {
    return list(this.directory, options)
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
  all?: boolean
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

  if (!options.name && !options.count && !options.begin && !options.all) {
    return Promise.reject<string[]>(
      new ImmigrationError(`Specify list options to filter migrations or use "all"`)
    )
  }

  if (extensions.length === 0) {
    extensions.push('.js')
  }

  return readdir(path)
    // Filter by name and supported extensions.
    .then(files => {
      if (options.name) {
        files = files.filter(filename => toName(filename) === options.name)
      }

      return files.filter(filename => extensions.indexOf(extname(filename)) > -1).sort()
    })
    // Reverse the list.
    .then(files => {
      return options.reverse ? files.reverse() : files
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
        if (options.reverse) {
          return files.slice(0, options.count)
        }

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
function run (fn: (cb?: (err?: Error, res?: any) => any) => any): Promise<any> {
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

  constructor (cause?: Error) {
    super('Failed to acquire migration lock', cause)
  }
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
  executed (): Executed[] | Promise<Executed[]>
  lock (): void | Promise<void>
  unlock (): void | Promise<void>
  isLocked (): boolean | Promise<boolean>
  log (name: string, status: Status, date: Date): void | Promise<void>
  unlog (name: string): void | Promise<void>
}
