/*
 * Copyright 2020 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const cp = require('child_process')
const glob = require('glob')
const path = require('path')

const cwd = path.resolve(__dirname, '..')
const benchpath = path.resolve(cwd, 'test/benchmark')

const tests = []
const globs = []
const opts = Object.create(null)

process.argv.slice(2).forEach(function forEachFileArg(file) {
  if (/^--/.test(file)) {
    opts[file.substr(2)] = true
  } else if (/[*]/.test(file)) {
    globs.push(path.join(benchpath, file))
  } else if (/\.bench\.js$/.test(file)) {
    tests.push(path.join(benchpath, file))
  } else {
    globs.push(
      path.join(benchpath, file, '*.bench.js'),
      path.join(benchpath, file + '*.bench.js'),
      path.join(benchpath, file, '**/*.bench.js')
    )
  }
})

if (tests.length === 0 && globs.length === 0) {
  globs.push(path.join(benchpath, '*.bench.js'), path.join(benchpath, '**/*.bench.js'))
}

class ConsolePrinter {
  /* eslint-disable no-console */
  addTest(name, child) {
    console.log(name)
    child.stdout.on('data', (d) => process.stdout.write(d))
    child.stderr.on('data', (d) => process.stderr.write(d))
    child.once('exit', () => console.log(''))
  }

  finish() {
    console.log('')
  }
  /* eslint-enable no-console */
}

class JSONPrinter {
  constructor() {
    this._tests = Object.create(null)
  }

  addTest(name, child) {
    let output = ''
    this._tests[name] = null
    child.stdout.on('data', (d) => (output += d.toString()))
    child.stdout.on('end', () => (this._tests[name] = JSON.parse(output)))
    child.stderr.on('data', (d) => process.stderr.write(d))
  }

  finish() {
    /* eslint-disable no-console */
    console.log(JSON.stringify(this._tests, null, 2))
    /* eslint-enable no-console */
  }
}

run()

async function run() {
  const printer = opts.json ? new JSONPrinter() : new ConsolePrinter()

  if (!globs.length) {
    return
  }

  const globPromises = globs.map((pattern) => {
    return new Promise((resolve, reject) => {
      glob(pattern, (err, matches) => {
        if (err) {
          reject(err)
        }
        resolve(matches)
      })
    })
  })

  try {
    const resolved = await Promise.all(globPromises)
    resolved.forEach(function mergeResolved(files) {
      files.forEach(function mergeFile(file) {
        if (tests.indexOf(file) === -1) {
          tests.push(file)
        }
      })
    })
  } catch(err) {
    console.error('Failed to glob:', err)
    process.exitCode = -1
    printer.finish()
  }

  tests.sort()
  for (const file of tests) {
    try {
      await new Promise((resolve, reject) => {
        const test = path.relative(benchpath, file)
        const args = [file]
        if (opts.inspect) {
          args.unshift('--inspect-brk')
        }
        const child = cp.spawn('node', args, { cwd: cwd, stdio: 'pipe' })
        printer.addTest(test, child)

        child.on('error', reject)
        child.on('exit', function onChildExit(code) {
          if (code) {
            const err = new Error('Benchmark exited with code ' + code)
            reject(err)
          }
          resolve()
        })
      })
    } catch(err) {
      console.error(`Spawning test ${file} failed:`, err)
      process.exitCode = -2
    }
  }

  printer.finish()
}
