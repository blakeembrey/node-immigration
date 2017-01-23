import test = require('blue-tape')
import { join } from 'path'
import fs = require('fs')
import thenify = require('thenify')
import * as immigration from './index'

const stat = thenify(fs.stat)
const readdir = thenify<string, string[]>(fs.readdir)
const unlink = thenify(fs.unlink)

const DIRECTORY = join(__dirname, '../test/migrations')
const SUCCESS_FILE = join(__dirname, '../test/.success')

test('immigration', t => {
  t.test('clean migration', t => {
    const migrate = new immigration.Migrate(undefined, DIRECTORY)

    t.test('up', t => {
      return migrate.migrate('up', {
        all: true
      })
        .then(() => {
          return stat(SUCCESS_FILE).then(stats => t.ok(stats.isFile()))
        })
    })

    t.test('down', t => {
      t.plan(1)

      return migrate.migrate('down', {
        all: true
      })
        .then(() => {
          return stat(SUCCESS_FILE).catch(() => t.pass('file was removed'))
        })
    })
  })

  t.test('fs migration', t => {
    const plugin = immigration.createPlugin(
      { _: ['../../fs'] },
      DIRECTORY
    )

    const migrate = new immigration.Migrate(plugin, DIRECTORY)

    t.test('up', t => {
      return migrate.migrate('up', {
        new: true
      })
        .then(() => {
          return stat(SUCCESS_FILE).then(stats => t.ok(stats.isFile()))
        })
    })

    t.test('up (again)', t => {
      const now = Date.now()

      return migrate.migrate('up', {
        new: true
      })
        .then(() => {
          return stat(SUCCESS_FILE).then(stats => t.ok(stats.mtime.getTime() < now))
        })
    })

    t.test('down', t => {
      t.plan(1)

      return migrate.migrate('down', {
        all: true
      })
        .then(() => {
          return stat(SUCCESS_FILE).catch(() => t.pass('file was removed'))
        })
    })

    t.test('cleanup', () => {
      return unlink(join(DIRECTORY, '.migrate.json'))
    })
  })

  t.test('create', t => {
    return immigration.create({
      name: 'foobar',
      directory: DIRECTORY
    })
      .then(() => {
        return readdir(DIRECTORY)
      })
      .then(files => {
        const file = files[files.length - 1]

        t.equal(files.length, 2)
        // `YYYYMMDDHHMMSS`.
        t.ok(/\d{14}_foobar\.js/.test(file))

        return unlink(join(DIRECTORY, file))
      })
  })
})
