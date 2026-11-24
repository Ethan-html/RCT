// One executable, two jobs. Normally this is the launcher. When the launcher starts an Electron app
// (like Redcast) it runs this same executable again with RED_RUN_APP set, and runner.js loads that
// app's own main.js. That is how every app shares the one Electron engine installed with the launcher.
if (process.env.RED_RUN_APP) require('./runner');
else require('./lib/launcher');
