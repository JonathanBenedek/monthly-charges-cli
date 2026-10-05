#!/usr/bin/env node
const { Command } = require('commander');
const { getAuthorizedClient, runConsentFlow, TOKEN_PATH } = require('../src/drive/auth');
const { createDriveClient } = require('../src/drive/driveClient');
const { runListMonths } = require('../src/cli/listMonths');
const { runShowMonth } = require('../src/cli/showMonth');
const { runAddMonth } = require('../src/cli/addMonth');
const { runEditMonth } = require('../src/cli/editMonth');
const { emit, fail } = require('../src/cli/output');

const program = new Command();
program
  .name('monthly-charges-cli')
  .description('Add/edit months of expense data in the same Google Drive store the web app reads from.');

async function withDrive(folderOpt, commandName, fn) {
  try {
    const auth = await getAuthorizedClient();
    const drive = createDriveClient(auth, { folderName: folderOpt });
    return await fn(drive);
  } catch (e) {
    emit(fail(commandName, e.message));
    return 1;
  }
}

program
  .command('auth')
  .description('One-time Google OAuth consent; caches a refresh token locally for headless reuse.')
  .action(async () => {
    try {
      await runConsentFlow();
      emit({ ok: true, command: 'auth', message: `Authenticated. Token cached at ${TOKEN_PATH}.` });
    } catch (e) {
      emit(fail('auth', e.message));
      process.exitCode = 1;
    }
  });

program
  .command('list-months')
  .description('List months saved in Drive.')
  .option('--folder <name>', 'Override the Drive root folder name (e.g. a disposable test folder)')
  .action(async (opts) => {
    process.exitCode = await withDrive(opts.folder, 'list-months', (drive) => runListMonths(drive));
  });

program
  .command('show-month')
  .description("Show a month's parsed/categorized transactions and category totals.")
  .requiredOption('--month <name>', 'Month name, e.g. April26')
  .option('--folder <name>', 'Override the Drive root folder name')
  .action(async (opts) => {
    process.exitCode = await withDrive(opts.folder, 'show-month', (drive) => runShowMonth(drive, { month: opts.month }));
  });

program
  .command('add-month')
  .description('Parse a credit-card Excel export and/or bank statement PDF and add/replace a month. Defaults to dry-run.')
  .requiredOption('--month <name>', 'Month name, e.g. April26')
  .option('--excel <path>', 'Path to the credit-card .xlsx export')
  .option('--pdf <path>', 'Path to the bank statement .pdf')
  .option('--commit', 'Write changes to Drive (default: dry-run preview only)', false)
  .option('--folder <name>', 'Override the Drive root folder name')
  .action(async (opts) => {
    process.exitCode = await withDrive(opts.folder, 'add-month', (drive) =>
      runAddMonth(drive, { month: opts.month, excel: opts.excel, pdf: opts.pdf, commit: !!opts.commit })
    );
  });

program
  .command('edit-month')
  .description('Apply a transaction/budget patch to an existing month. Defaults to dry-run.')
  .requiredOption('--month <name>', 'Month name, e.g. April26')
  .requiredOption('--patch <path>', 'Path to a patch JSON file (see CLI.md for the shape)')
  .option('--commit', 'Write changes to Drive (default: dry-run preview only)', false)
  .option('--folder <name>', 'Override the Drive root folder name')
  .action(async (opts) => {
    process.exitCode = await withDrive(opts.folder, 'edit-month', (drive) =>
      runEditMonth(drive, { month: opts.month, patch: opts.patch, commit: !!opts.commit })
    );
  });

program.parseAsync(process.argv);
