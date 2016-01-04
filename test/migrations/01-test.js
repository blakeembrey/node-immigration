var fs = require('fs')
var join = require('path').join

var PATH = join(__dirname, '../.success')

exports.up = function (done) {
  return fs.writeFile(PATH, 'success', done)
}

exports.down = function (done) {
  return fs.unlink(PATH, done)
}
