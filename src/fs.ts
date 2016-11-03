import thenify = require('thenify')
import lockfile = require('lockfile')
import * as fs from 'fs'
import { join } from 'path'
import { Plugin, PluginOptions } from './index'

const readFile = thenify<string, string, string>(fs.readFile)
const writeFile = thenify<string, string, void>(fs.writeFile)
const lockFile = thenify(lockfile.lock)
const unlockFile = thenify(lockfile.unlock)

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

  function read (path: string) {
    return readFile(path, 'utf8').then(
      (contents) => JSON.parse(contents) as FileJson,
      () => ({} as FileJson)
    )
  }

  function log (name: string, status: string, date: Date) {
    return read(path).then((file: FileJson) => {
      file[name] = { status, date: date.toISOString() }

      return writeFile(path, JSON.stringify(file, null, 2))
    })
  }

  function unlog (name: string) {
    return read(path).then((file: FileJson) => {
      delete file[name]

      return writeFile(path, JSON.stringify(file, null, 2))
    })
  }

  function lock () {
    return lockFile(`${path}.lock`)
  }

  function unlock () {
    return unlockFile(`${path}.lock`)
  }

  function executed () {
    return read(path).then((file: FileJson) => {
      return Object.keys(file).map((key) => {
        return {
          name: key,
          status: file[key].status,
          date: new Date(file[key].date)
        }
      })
    })
  }

  return { executed, lock, unlock, log, unlog }
}
