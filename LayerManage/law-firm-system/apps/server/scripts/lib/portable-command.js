'use strict';

async function routePortableCommand(argv, dependencies) {
  if (argv.length === 0) {
    await dependencies.runServer();
    return undefined;
  }
  if (argv[0] === 'events:drain') {
    return dependencies.runDrain(argv.slice(1));
  }
  if (argv[0] === 'events:check') {
    return dependencies.runCheck(argv.slice(1));
  }
  dependencies.stderr.write('Application command is invalid.\n');
  return 2;
}

module.exports = { routePortableCommand };
