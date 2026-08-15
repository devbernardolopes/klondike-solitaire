const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const pkgPath = path.resolve(__dirname, '../package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))

const parts = pkg.version.split('.').map(Number)
parts[2] = (parts[2] || 0) + 1
pkg.version = parts.join('.')

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
execSync('git add package.json', { cwd: path.resolve(__dirname, '..') })
