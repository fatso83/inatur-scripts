#!/usr/bin/env node

const fs = require('node:fs/promises');
const {
  DEFAULT_AIRBNB_ICAL_URL,
  loadDotEnv
} = require('./lib/local-runtime');
const { runSync } = require('./lib/sync-runner');

function getArg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function validateArgs(args = process.argv.slice(2)) {
  const optionsWithValue = new Set(['--from-file', '--ical-url', '--offer-file']);
  const booleanOptions = new Set(['--publish', '--include-airbnb-unavailable', '--help', '-h']);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('-')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    if (booleanOptions.has(arg)) continue;
    if (optionsWithValue.has(arg)) {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`Missing value for ${arg}`);
      }
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
}

function printHelp() {
  console.log(`Usage: sync-airbnb-inatur.js [options]

Sync Airbnb reservations to Inatur blocked periods. By default, the script only previews changes.

Options:
  --publish                         Save and publish changes in Inatur.
  --from-file <path>                Read Airbnb iCal from a local file instead of URL.
  --ical-url <url>                  Read Airbnb iCal from this URL instead of AIRBNB_ICAL_URL/default.
  --offer-file <path>               Read Inatur offer JSON from a local file for offline preview.
  --include-airbnb-unavailable      Also sync Airbnb "Not available" blocks. By default only Reserved events sync.
  --help, -h                        Show this help text.

Environment:
  AIRBNB_ICAL_URL                   Optional; overrides built-in Airbnb iCal fallback.
  INATUR_SELLER_ID                  Optional; defaults to Holmevann seller id.
  INATUR_NODE_ID                    Optional; defaults to Holmevann sales page id.
  INATUR_CARD_ID                    Optional; defaults to Holmevann product/card id.
  INATUR_AVAILABILITY_ICAL_URL      Optional; fetched after publish as a sanity check.

Authentication:
  Inatur cookies are handled by ./cookie-store and cookies.json.
  CSRF token is extracted automatically from the Inatur edit page.`);
}

async function readIcal() {
  const file = getArg('--from-file');
  if (file) return fs.readFile(file, 'utf8');

  const url = getArg('--ical-url') ?? process.env.AIRBNB_ICAL_URL ?? DEFAULT_AIRBNB_ICAL_URL;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} from Airbnb iCal URL`);
  return response.text();
}

async function readOfferFromFile() {
  const offerFile = getArg('--offer-file');
  return JSON.parse(await fs.readFile(offerFile, 'utf8'));
}

async function main() {
  if (hasFlag('--help') || hasFlag('-h')) {
    printHelp();
    return;
  }

  validateArgs();
  loadDotEnv();

  const shouldPublish = hasFlag('--publish');
  const offerFile = getArg('--offer-file');
  if (shouldPublish && offerFile) {
    throw new Error('Refusing --publish with --offer-file; --offer-file is for offline preview only.');
  }

  await runSync({
    publish: shouldPublish,
    includeAirbnbUnavailable: hasFlag('--include-airbnb-unavailable'),
    offerFile,
    readIcal,
    readOfferFromFile,
    config: {
      sellerId: process.env.INATUR_SELLER_ID,
      nodeId: process.env.INATUR_NODE_ID,
      cardId: process.env.INATUR_CARD_ID,
      availabilityIcalUrl: process.env.INATUR_AVAILABILITY_ICAL_URL
    }
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
