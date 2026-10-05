// Every CLI command prints exactly one JSON object to stdout; progress/logging
// goes to stderr so stdout stays reliably parseable by the calling agent.

function emit(payload) {
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
}

function fail(command, message, warnings) {
  return { ok: false, command, error: message, warnings: warnings || [] };
}

function emitFail(command, message, warnings) {
  emit(fail(command, message, warnings));
  return 1;
}

function log(...args) {
  console.error(...args);
}

module.exports = { emit, fail, emitFail, log };
