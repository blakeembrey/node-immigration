const { promises: fs } = require("fs");
const { join } = require("path");

var PATH = join(__dirname, "../out/2");

exports.up = function (done) {
  return fs.writeFile(PATH, "success", done);
};

exports.down = function (done) {
  return fs.unlink(PATH, done);
};
