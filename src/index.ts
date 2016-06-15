import fs = require('fs')
import thenify = require('thenify')
import { resolve, join, extname, basename } from 'path'
import Promise = require('any-promise')
import tch = require('touch')
import arrify = require('arrify')
import { BaseError } from 'make-error-cause'
import pad = require('pad-left')
import chalk = require('chalk')

const touch = thenify(tch)
const readdir = thenify(fs.readdir)

/**
 * Execute a migration.
 */
function immigration (cmd: string, name: string, options: immigration.Options = {}): Promise<boolean> {
  const dir = resolve(options.directory || 'migrations')
  const extensions = arrify(options.extension)
  const log = logger(options.log)

  // Use `.js` by default.
  if (extensions.length === 0) {
    extensions.push('.js')
  }

  if (cmd === 'create') {
    const date = new Date()
    const prefix = String(date.getUTCFullYear()) +
      pad(String(date.getUTCMonth() + 1), 2, '0') +
      pad(String(date.getUTCDate()), 2, '0') +
      pad(String(date.getUTCHours()), 2, '0') +
      pad(String(date.getUTCMinutes()), 2, '0') +
      pad(String(date.getUTCSeconds()), 2, '0')
    const suffix = name ? `-${name}` : ''
    const extension = extensions[0]

    return touch(join(dir, `${prefix}${suffix}${extension}`)).then(() => true)
  }

  if (cmd === 'list') {
    return listFiles(dir, name, extensions, options)
      .then(files => {
        for (const file of files) {
          log(`${chalk.cyan('•')} ${toName(file)}`)
        }

        return true
      })
  }

  if (cmd === 'up' || cmd === 'down') {
    if (!options.count && !options.begin && !name && !options.all) {
      const msg = 'Requires `count`, `begin`, `all`, or a migration name'

      log('')
      log(`${chalk.red('⨯')} ${msg}`)
      log('')

      return Promise.reject(new ImmigrationError(msg))
    }

    return listFiles(dir, name, extensions, options)
      // Reverse files when going "down".
      .then(files => cmd === 'up' ? files : files.reverse())
      // Execute the migrations.
      .then(files => {
        const migrations = files.map(x => join(dir, x))

        if (migrations.length === 0) {
          return Promise.reject(new ImmigrationError('No migrations found'))
        }

        return migrations.reduce<Promise<any>>(
          (p, path) => {
            const name = toName(path)

            return p
              .then(() => {
                const m = require(path)
                const fn = m[cmd]

                // Skip missing up/down methods.
                if (fn == null) {
                  return
                }

                if (typeof fn !== 'function') {
                  throw new ImmigrationError(`Migration ${cmd} is not a function: ${name}`, null, path)
                }

                log(`${chalk.magenta(cmd)} ${name}`)

                return run(fn).catch(error => {
                  throw new ImmigrationError(`Migration ${cmd} failed on ${name}`, error, path)
                })
              })
          },
          Promise.resolve()
        )
          .then(
            () => {
              log('')
              log(`${chalk.green('✔')} Migration complete`)
              log('')

              return true
            },
            (error) => {
              log('')
              log(`${chalk.red('⨯')} Migration failed`)
              log('')
              log(error.toString())
              log('')

              return Promise.reject(error)
            })
      })
  }

  return Promise.reject(new TypeError(`Unknown migration command: ${cmd}`))
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
 * Get the name from a path.
 */
function toName (path: string): string {
  return basename(path).replace(/\.[^\.]+$/, '')
}

/**
 * Logging function.
 */
function logger (shouldLog: boolean) {
  if (shouldLog) {
    return (msg: string) => console.error(msg)
  }

  return (msg: string): void => undefined
}

/**
 * List available files.
 */
function listFiles (dir: string, name: string, extensions: string[], options: immigration.Options) {
  return readdir(dir)
    // Filter by name and supported extensions.
    .then(files => {
      if (name) {
        files = files.filter(filename => toName(filename) === name)
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
 * Error cause base.
 */
class ImmigrationError extends BaseError {
  name = 'ImmigrationError'

  constructor (msg: string, cause?: Error, public path?: string) {
    super(msg, cause)
  }
}

/**
 * Expose options.
 */
namespace immigration {
  export interface Options {
    all?: boolean
    directory?: string
    begin?: string
    count?: number
    extension?: string | string[]
    log?: boolean
  }
}

export = immigration
