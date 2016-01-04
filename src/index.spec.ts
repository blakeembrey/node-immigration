import test = require('blue-tape')
import immigration = require('./index')
import { join } from 'path'
import fs = require('fs')
import thenify = require('thenify')

const stat = thenify(fs.stat)
const readdir = thenify(fs.readdir)
const unlink = thenify(fs.unlink)

const DIRECTORY = join(__dirname, '../test/migrations')
const SUCCESS_FILE = join(__dirname, '../test/.success')

test('immigration', t => {
  t.test('up', t => {
    return immigration('up', null, {
      all: true,
      directory: DIRECTORY
    })
      .then(result => {
        t.equal(result, true)

        return stat(SUCCESS_FILE)
      })
      .then(stats => stats.isFile())
  })

  t.test('down', t => {
    t.plan(2)

    return immigration('down', null, {
      all: true,
      directory: DIRECTORY
    })
      .then(result => {
        t.equal(result, true)

        return stat(SUCCESS_FILE).catch(() => t.pass('file was removed'))
      })
  })

  t.test('create', t => {
    return immigration('create', 'foobar', {
      directory: DIRECTORY
    })
      .then(result => {
        return readdir(DIRECTORY)
      })
      .then(files => {
        const file = files[files.length - 1]
        t.equal(files.length, 2)
        // YYYYMMDDHHMMSS
        t.ok(/\d{14}\-foobar\.js/.test(file))

        return unlink(join(DIRECTORY, file))
      })
  })
})
