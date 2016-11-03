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
    if (!options.name && !options.count && !options.begin && !options.all) {
      if (this.plugin) {
        const opt = cmd === 'up' ? 'new' : 'since'

        if (!options.hasOwnProperty(opt)) {
          return Promise.reject(new TypeError(`Requires "count", "begin", "all", "${opt}", or a migration name to run`))
        }
      } else {
        return Promise.reject(new TypeError(`Requires "count", "begin", "all", or a migration name to run`))
      }
    }

    const date = new Date()
    const path = resolve(options.directory || 'migrations')
    const since = typeof options.since === 'string' ? ms(options.since) : Infinity

    const p = this.lock()
      .then(() => {
        return Promise.all([
          list(path, options),
          this.executed()
        ])
      })
      .then(([files, executed]) => {
        const migrations = (cmd === 'up' ? files : files.reverse()).map(file => join(path, file))

        if (migrations.length === 0) {
          return Promise.reject(new ImmigrationError('No matching migrations found', undefined, path))
        }

        // Check for bad migrations before proceeding.
        for (const execution of executed) {
          if (execution.status !== 'done') {
            return Promise.reject(new ImmigrationError(
              `A previously executed migration ("${execution.name}") is in a "${execution.status}" state. ` +
              `Please "unlog" to mark as resolved before continuing`,
              undefined,
              path
            ))
          }
        }

        // Run each migration in order, skipping already executed or missing functions when "executed".
        return migrations.reduce<Promise<any>>(
          (p, path) => {
            const name = toName(path)
            const match = executed.filter(x => x.name === name)
            const exists = cmd === 'up' ?
              (options.new ? !!match.length : false) :
              match.some(x => x.date.getTime() < date.getTime() - since)

            if (exists) {
              return p
            }

            return p
              .then(() => {
                const m = require(path)
                const fn = m[cmd]
                const start = Date.now()

                // Skip missing up/down methods.
                if (fn == null) {
                  this.emit('skipped', name)
                  return
                }

                if (typeof fn !== 'function') {
                  throw new ImmigrationError(`Migration ${cmd} is not a function: ${name}`, undefined, path)
                }

                this.emit('pending', name)

                return this.log(name, 'pending', date)
                  .then(() => run(fn))
                  .then(
                    () => {
                      this.emit('done', name, Date.now() - start)

                      return cmd === 'down' ? this.unlog(name) : this.log(name, 'done', date)
                    },
                    (error) => {
                      this.emit('failed', name, Date.now() - start)

                      return this.log(name, 'failed', date)
                        .then(() => {
                          let message = `Migration ${cmd} failed on ${name}`

                          if (this.plugin) {
                            message += '\nYou will need to run `unlog` before trying again'
                          }

                          return Promise.reject(new ImmigrationError(message, error, path))
                        })
                    }
                  )
              })
          },
          Promise.resolve()
        )
      })
      .then(() => undefined)

    return promiseFinally(p, () => this.unlock())
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
    // Filter by name and supported extensions.
    .then(files => {
      if (options.name) {
        files = files.filter(filename => toName(filename) === options.name)
      }

      return files.filter(filename => extensions.indexOf(extname(filename)) > -1).sort()
    })
    // Support "count" option.
    .then(files => {
      if (options.count) {
        return files.slice(-options.count)
      }

      return files
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
 * Error cause base.
 */
export class ImmigrationError extends BaseError {
  name = 'ImmigrationError'

  constructor (msg: string, cause?: Error, public path?: string) {
    super(msg, cause)
  }
}

/**
 * What the executed array should look like.
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
