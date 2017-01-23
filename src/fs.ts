import Promise = require('any-promise')
import thenify = require('thenify')
import * as fs from 'fs'
import { join } from 'path'
import { Encoding } from 'buffer'
import { Plugin, PluginOptions, LockRetryError } from './index'

const readFile = thenify<string, Encoding, string>(fs.readFile)
const writeFile = thenify<string, string, void>(fs.writeFile)
const open = thenify<string, string, number>(fs.open)
const close = thenify<number, void>(fs.close)
const unlink = thenify(fs.unlink)
const stat = thenify(fs.stat)

/**
 * Options for the migration plugin.
 */
export interface Options extends PluginOptions {
  path: string
}

/**
 * Format of the JSON storage file.
 */
export interface FileJson {
  [name: string]: { status: string, date: string }
}

/**
 * Initialize the `fs` migration plugin.
 */
export function init (options: Options, dir: string): Plugin {
  const path = join(dir, options.path || '.migrate.json')
  const lockfile = `${path}.lock`
  let pending = Promise.resolve()

  function update (fn: (file: FileJson) => FileJson) {
    pending = pending.then(() => {
      return read().then(contents => writeFile(path, JSON.stringify(fn(contents), null, 2)))
    })

    return pending
  }

  function read () {
    return readFile(path, 'utf8').then(
      (contents) => JSON.parse(contents) as FileJson,
      () => ({} as FileJson)
    )
  }

  function log (name: string, status: string, date: Date) {
    return update((contents) => {
      contents[name] = { status, date: date.toISOString() }

      return contents
    })
  }

  function unlog (name: string) {
    return update((contents) => {
      delete contents[name]

      return contents
    })
  }

  function lock () {
    return open(lockfile, `wx`)
      .then(
        (fd) => close(fd),
        (err) => {
          if (err.code === 'EEXIST') {
            throw new LockRetryError(err)
          }

          return Promise.reject(err)
        }
      )
  }

  function unlock () {
    return unlink(lockfile).catch(() => undefined)
  }

  function isLocked () {
    return stat(lockfile)
      .then(
        () => true,
        (err) => {
          if (err.code === 'ENOENT') {
            return false
          }

          return Promise.reject<boolean>(err)
        }
      )
  }

  function executed () {
    return read().then((file: FileJson) => {
      return Object.keys(file).map((key) => {
        return {
          name: key,
          status: file[key].status,
          date: new Date(file[key].date)
        }
      })
    })
  }

  return { executed, lock, isLocked, unlock, log, unlog }
}
