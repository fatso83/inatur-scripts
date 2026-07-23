const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

test('preview prints human-readable add and remove actions without publishing', () => {
  const result = spawnSync(process.execPath, [
    'sync-airbnb-inatur.js',
    '--from-file',
    path.join('test', 'fixtures', 'airbnb-basic.ics'),
    '--offer-file',
    path.join('test', 'fixtures', 'inatur-offer-basic.json')
  ], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Forhåndsvisning: ingen endringer blir lagret eller publisert\./);
  assert.match(result.stdout, /vil slette sperring 24\.10\.2026 -> 25\.10\.2026/);
  assert.match(result.stdout, /vil legge til sperring 20\.10\.2026 -> 21\.10\.2026/);
  assert.match(result.stdout, /"publish": false/);
  assert.match(result.stdout, /"add": 1/);
  assert.match(result.stdout, /"remove": 1/);
});

test('preview is the default when publish is not set', () => {
  const result = spawnSync(process.execPath, [
    'sync-airbnb-inatur.js',
    '--from-file',
    path.join('test', 'fixtures', 'airbnb-basic.ics'),
    '--offer-file',
    path.join('test', 'fixtures', 'inatur-offer-basic.json')
  ], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Forhåndsvisning: ingen endringer blir lagret eller publisert\./);
  assert.match(result.stdout, /"publish": false/);
});

test('prints help without requiring cookies or network', () => {
  const result = spawnSync(process.execPath, ['sync-airbnb-inatur.js', '--help'], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: sync-airbnb-inatur\.js \[options\]/);
  assert.match(result.stdout, /only previews changes/);
  assert.match(result.stdout, /--publish/);
  assert.doesNotMatch(result.stdout, /--dry-run/);
  assert.match(result.stdout, /--include-airbnb-unavailable/);
});

test('rejects removed dry-run option', () => {
  const result = spawnSync(process.execPath, [
    'sync-airbnb-inatur.js',
    '--from-file',
    path.join('test', 'fixtures', 'airbnb-basic.ics'),
    '--offer-file',
    path.join('test', 'fixtures', 'inatur-offer-basic.json'),
    '--dry-run'
  ], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8'
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown option: --dry-run/);
});

test('refuses publish with offline offer fixture', () => {
  const result = spawnSync(process.execPath, [
    'sync-airbnb-inatur.js',
    '--from-file',
    path.join('test', 'fixtures', 'airbnb-basic.ics'),
    '--offer-file',
    path.join('test', 'fixtures', 'inatur-offer-basic.json'),
    '--publish'
  ], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8'
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing --publish with --offer-file/);
});
