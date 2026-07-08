function unfoldIcal(input) {
  return input.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
}

function parseIcalDate(value) {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`Unsupported iCal date: ${value}`);
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function isBookableReservation(event) {
  return event.summary === 'Reserved';
}

function parseAirbnbIcal(input, { includeUnavailable = false } = {}) {
  const lines = unfoldIcal(input).split(/\r?\n/);
  const events = [];
  let current = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (current?.startDate && current?.endDateExclusive) {
        if (includeUnavailable || isBookableReservation(current)) {
          events.push(current);
        }
      }
      current = null;
      continue;
    }
    if (!current) continue;

    const [rawName, ...rest] = line.split(':');
    const value = rest.join(':');
    const name = rawName.split(';')[0].toUpperCase();

    if (name === 'DTSTART') current.startDate = parseIcalDate(value);
    if (name === 'DTEND') current.endDateExclusive = parseIcalDate(value);
    if (name === 'SUMMARY') current.summary = value;
    if (name === 'UID') current.uid = value;
  }

  return events;
}

module.exports = { parseAirbnbIcal };
