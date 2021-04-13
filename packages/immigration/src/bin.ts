#!/usr/bin/env node

import arg from "arg";
import ms from "ms";
import chalk from "chalk";
import { relative } from "path";
import { Migrate, Storage, ImmigrationError, FS_STORAGE } from "./index";

const HELP_SPEC = {
  "--help": Boolean,
};

const RUN_ARG_SPEC = {
  ...HELP_SPEC,
  "--directory": String,
  "--extension": String,
  "--store": String,
  "-d": "--directory",
  "-e": "--extension",
  "-s": "--store",
};

const LIST_ARG_SPEC = {
  ...HELP_SPEC,
  "--count": Number,
  "--reverse": Boolean,
  "--gte": String,
  "--lte": String,
  "-c": "--count",
};

const MIGRATE_ARG_SPEC = {
  ...HELP_SPEC,
  "--dry-run": Boolean,
  "--to": String,
  "--all": Boolean,
  "--check": Number,
  "--wait": String,
  "-d": "--dry-run",
};

const FAIL_ICON = chalk.red`⨯`;
const SUCCESS_ICON = chalk.green`✔`;
const NEXT_ICON = chalk.dim`➜`;

/** Log text output with an icon, skip the icon in non-TTY environments. */
const format = (icon: string, text: string) => {
  if (chalk.supportsColor) return `${icon} ${text}`;
  return text;
};

/**
 * Run the CLI script.
 */
async function run(argv: string[]): Promise<void> {
  const {
    _,
    "--help": help,
    "--store": store,
    "--directory": directory = "migrations",
    "--extension": extension,
  } = arg(RUN_ARG_SPEC, {
    argv,
    stopAtPositional: true,
  });

  const [commandName, ...args] = _;

  if (help || !commandName) {
    return console.log(`
immigration [options] [command]

Options:
  --store [plugin]    Loads a plugin for state storage (default: "fs")
  --directory [dir]   Directory to read migrations from
  --extension [ext]   Specify the default extension to support

Commands:
  up        Run up migration scripts
  down      Run down migration scripts
  create    Create a new migration file
  list      List available migrations
  history   List the run migrations
  force     Force a migration to be valid
  remove    Remove a migration
`);
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const storage = store ? (require(store) as Storage) : FS_STORAGE;
  const migrate = new Migrate({ directory, storage, extension });

  migrate.on("skip", (name) => {
    console.log(format(chalk.dim`-`, `Skipped: ${name}`));
  });

  migrate.on("plan", (name) => {
    console.log(format(chalk.cyan`-`, `Planned: ${name}`));
  });

  migrate.on("start", (name) => {
    console.log(format(chalk.yellow`○`, `Applying: ${name}`));
  });

  migrate.on("end", (name, success, duration) => {
    const iconText = success ? SUCCESS_ICON : FAIL_ICON;
    const statusText = success ? "success" : "failed";
    const durationText = chalk.magenta(ms(duration));
    console.log(
      format(iconText, `Done: ${name} (${statusText}) ${durationText}`)
    );
  });

  migrate.on("wait", (count, duration, maxWait) => {
    console.log(
      format(chalk.yellow`…`, `Waiting: ${ms(duration)} / ${ms(maxWait)}`)
    );
  });

  // Run the migration up/down.
  async function migration(direction: "up" | "down", argv: string[]) {
    const {
      "--help": help,
      "--dry-run": dryRun,
      "--to": to,
      "--all": all,
      "--check": check,
      "--wait": wait,
    } = arg(MIGRATE_ARG_SPEC, { argv });

    if (help) {
      return console.log(`
immigration ${direction} [options]

Options:
  --to [string]  The migration to end on (${
    direction === "up" ? "inclusive" : "exclusive"
  })
  --all          Run all the migrations without specifying \`--to\`
  --dry-run      Only preview the migrations, do not run them
  --check [int]  The number of past migrations to validate exist before proceeding
  --wait         Maximum duration to wait for lock to be acquired
`);
    }

    const maxWait = wait ? ms(wait) : undefined;
    const migrations = await migrate.migrate(direction, {
      dryRun,
      to,
      all,
      check,
      maxWait,
    });

    if (migrations.length) {
      console.log(format(SUCCESS_ICON, "Migrations finished"));
    } else {
      console.log(format(chalk.yellow`…`, "No migrations required"));
    }
  }

  // Get the migration history.
  async function history(argv: string[]) {
    const {
      "--help": help,
      "--count": count,
      "--gte": gte,
      "--lte": lte,
      "--reverse": reverse,
    } = arg(LIST_ARG_SPEC, { argv });

    if (help) {
      return console.log(`
immigration history [options]

Lists historically executed migrations and their timestamps.

Options:
  --count [int]   The number of migrations to list
  --gte [string]  The first migration to start from
  --lte [string]  The final migration to end on
  --reverse       Reverse the order of the migrations
`);
    }

    const migrations = migrate.history({ count, reverse, gte, lte });

    for await (const migration of migrations) {
      console.log(
        [
          migration.name,
          chalk.bold(migration.valid ? "VALID" : "INVALID"),
          chalk.magenta(migration.date.toLocaleString()),
        ].join(" ")
      );
    }
  }

  // Force the migration state.
  async function force(argv: string[]) {
    const {
      _: [name],
      "--help": help,
    } = arg(HELP_SPEC, { argv });

    if (help) {
      return console.log(`
immigration force [name]

Forces the migration to be marked as valid in state.
`);
    }

    if (!name) throw new ImmigrationError("No migration name to update");

    await migrate.update(name, true);
    console.log(format(SUCCESS_ICON, "Migration forced to be valid"));
  }

  // Remove a migration status.
  async function remove(argv: string[]) {
    const {
      _: [name],
      "--help": help,
    } = arg(HELP_SPEC, { argv });

    if (help) {
      return console.log(`
immigration remove [name]

Removes a migration from state.
`);
    }

    if (!name) throw new ImmigrationError("No migration name to remove");

    const removed = await migrate.remove(name);
    if (!removed) return console.log(format(FAIL_ICON, "Migration not found"));
    return console.log(format(SUCCESS_ICON, "Migration removed"));
  }

  // Print lock state.
  const printLockState = (isLocked: boolean) => {
    const icon = isLocked ? "🔒" : "🔓";
    const state = chalk.bold(isLocked ? "LOCKED" : "UNLOCKED");
    console.log(format(icon, `Migration state: ${state}`));
    return process.exit(isLocked ? 1 : 0);
  };

  // Remove the current migration lock.
  async function unlock() {
    const { "--help": help } = arg(HELP_SPEC, { argv });

    if (help) {
      return console.log(`
immigration unlock

Force the migration state to be unlocked.
`);
    }

    await migrate.unlock();
    return printLockState(false);
  }

  // Check if the migration is locked.
  async function locked() {
    const { "--help": help } = arg(HELP_SPEC, { argv });

    if (help) {
      return console.log(`
immigration locked

Print whether the migration state is locked and exit 0 when unlocked.
`);
    }

    const isLocked = await migrate.isLocked();
    return printLockState(isLocked);
  }

  // List available migrations.
  async function list(argv: string[]) {
    const {
      "--help": help,
      "--count": count,
      "--gte": gte,
      "--lte": lte,
      "--reverse": reverse,
    } = arg(LIST_ARG_SPEC, { argv });

    if (help) {
      return console.log(`
immigration list [options]

Lists migration files available locally.

Options:
  --count [int]   The number of migrations to list
  --gte [string]  The first migration to start from
  --lte [string]  The final migration to end on
  --reverse       Reverse the order of the migrations
`);
    }

    const files = migrate.list({ count, gte, lte, reverse });

    for await (const file of files) console.log(file);
  }

  // Create a new migration file.
  async function create(argv: string[]) {
    const { "--help": help, _: title } = arg(HELP_SPEC, { argv });

    if (help) {
      return console.log(`
immigration create [name]

Creates a new migration file prefixed with UTC timestamp.
`);
    }

    const path = await migrate.create(title.join(" "));
    const filename = relative(process.cwd(), path);
    console.log(format(SUCCESS_ICON, `File created: ${filename}`));
  }

  const commands = new Map<string, (argv: string[]) => void>([
    ["create", create],
    ["list", list],
    ["history", history],
    ["force", force],
    ["remove", remove],
    ["unlock", unlock],
    ["locked", locked],
    ["up", (argv) => migration("up", argv)],
    ["down", (argv) => migration("down", argv)],
  ]);

  const command = commands.get(commandName);

  if (!command) {
    throw new ImmigrationError(`Invalid command: ${commandName}`);
  }

  return command(args);
}

// Remember to force process termination after `run`.
run(process.argv.slice(2)).then(
  () => process.exit(0),
  (error) => {
    if (error instanceof ImmigrationError) {
      console.error(format(FAIL_ICON, error.message));
      if (error.path) {
        console.error(`File: ${relative(process.cwd(), error.path)}`);
      }
      if (error.cause) {
        console.error(format(NEXT_ICON, `Caused by: ${error.cause}`));
      }
    } else {
      console.error(error);
    }

    process.exit(1);
  }
);
