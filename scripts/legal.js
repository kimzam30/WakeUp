#!/usr/bin/env node
'use strict';
// Writes PRIVACY.md from src/ui/legal.js, the text both apps show. Edit legal.js, then run this.
const fs = require('node:fs');
const path = require('node:path');
const Legal = require('../src/ui/legal.js');

fs.writeFileSync(path.join(__dirname, '..', 'PRIVACY.md'), Legal.markdown());
console.log('PRIVACY.md written');
