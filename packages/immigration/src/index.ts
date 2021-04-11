import { promises as fs } from "fs";
import now from "performance-now";
import { resolve, join, extname } from "path";
import { BaseError } from "make-error-cause";
import pad from "pad-left";
import {
  iter,
  next,
  chain,
  iterable,
  zipLongest,
  list,
} from "iterative/dist/async";
import { Emitter } from "@servie/events";

/**
 * Errors caused during migration.
 */
export class ImmigrationError extends BaseError {
  constructor(msg: string, cause?: Error, public path?: string) {
    super(msg, cause);
  }
}

/**
 * Create a "retry lock" error.
 */
export class LockRetryError extends BaseError {
  constructor(cause?: Error) {
    super("Failed to acquire migration lock", cause);
  }
}

/**
 * Wrap an error as "safe", skips marking as invalid in storage.
 */
export class SafeMigrationError extends BaseError {}

/**
 * Lock acquisition options.
 */
export interface AcquireOptions {
  maxWait?: number;
  retryWait?: number;
}

/**
 * List options.
 */
export interface ListOptions {
  /** The number of migrations to list. */
  count?: number;
  /** Reverses the sort direction. */
  reverse?: boolean;
  /** The first migration to include. */
  gte?: string;
  /** The last migration to include. */
  lte?: string;
}

/**
 * Migrate options.
 */
export interface MigrateOptions extends AcquireOptions {
  /** Run the migration with doing a real migration. */
  dryRun?: boolean;
  /**
   * Historical migrations to validate before running, default `20`.
   *
   * Set to `1` to consider only the "latest" state.
   */
  check?: number;
  /** The migration to migrate down to. */
  to?: string;
  /** Migrate all the way to the last version available. */
  all?: boolean;
}

/**
 * What an execution is stored as.
 */
export interface Execution {
  name: string;
  valid: boolean;
  date: Date;
}

/**
 * Wrap type to allow promise or synchronous value.
 */
export type OrPromise<T> = T | Promise<T>;

/**
 * Options passed to plugins.
 */
export interface PluginOptions {
  cwd: string;
}

/**
 * The plugin only needs to export a single `create` function.
 */
export interface Storage {
  create(options: PluginOptions): OrPromise<Store>;
}

/**
 * Expose the required methods for migration.
 */
export interface Store {
  lock: () => OrPromise<void>;
  unlock: () => OrPromise<void>;
  isLocked: () => OrPromise<boolean>;
  history: (
    options: ListOptions
  ) => AsyncIterable<Execution> | Iterable<Execution>;
  show: (name: string) => OrPromise<Execution | undefined>;
  update: (name: string, dirty: boolean, date: Date) => OrPromise<void>;
  remove: (name: string) => OrPromise<boolean>;
}

/**
 * Initialization options.
 */
export interface InitializeOptions {
  storage: Storage;
  directory: string;
  cwd?: string;
  extension?: string;
}

/**
 * No lock needed.
 */
const NO_ATTEMPT = Symbol("NO_ATTEMPT");

/**
 * Valid migration events.
 */
export interface Events {
  skip: [name: string];
  start: [name: string];
  end: [name: string, success: boolean, duration: number];
  plan: [name: string];
  wait: [attempt: number, duration: number, maxWait: number];
}

/**
 * Migrate class.
 */
export class Migrate extends Emitter<Events> {
  cwd: string;
  directory: string;
  extension: string;
  storage: Storage;
  _store?: Promise<Store>;

  constructor(options: InitializeOptions) {
    super();

    this.storage = options.storage;
    this.directory = resolve(options.directory);
    this.cwd = options.cwd ?? process.cwd();
    this.extension = options.extension ?? ".js";
  }

  async getStore(): Promise<Store> {
    if (!this._store) {
      this._store = Promise.resolve(this.storage.create({ cwd: this.cwd }));
    }
    return this._store;
  }

  async create(title: string): Promise<string> {
    const date = new Date();
    const prefix =
      String(date.getUTCFullYear()) +
      pad(String(date.getUTCMonth() + 1), 2, "0") +
      pad(String(date.getUTCDate()), 2, "0") +
      pad(String(date.getUTCHours()), 2, "0") +
      pad(String(date.getUTCMinutes()), 2, "0") +
      pad(String(date.getUTCSeconds()), 2, "0");
    const label = title.replace(/\s+/g, "_").toLowerCase();
    const suffix = label ? `_${label}` : "";
    const path = join(this.directory, `${prefix}${suffix}${this.extension}`);

    await fs.open(path, "w").then((file) => file.close());

    return path;
  }

  async show(name: string): Promise<Execution | undefined> {
    const storage = await this.getStore();
    return storage.show(name);
  }

  async update(name: string, valid: boolean, date?: Date): Promise<void> {
    const storage = await this.getStore();
    return storage.update(name, valid, date ?? new Date());
  }

  async remove(filename: string): Promise<boolean> {
    const storage = await this.getStore();
    return storage.remove(filename);
  }

  async lock(): Promise<void> {
    const storage = await this.getStore();
    return storage.lock();
  }

  async unlock(): Promise<void> {
    const storage = await this.getStore();
    return storage.unlock();
  }

  async isLocked(): Promise<boolean> {
    const storage = await this.getStore();
    return storage.isLocked() ?? false;
  }

  async *history(options: ListOptions): AsyncIterable<Execution> {
    const storage = await this.getStore();
    yield* storage.history(options) ?? [];
  }

  async migrate(
    direction: "up" | "down",
    options: MigrateOptions
  ): Promise<string[]> {
    const { to = "", all = false, check = 50, dryRun = false } = options;

    if (all === !!to) {
      throw new ImmigrationError("Either `to` or `all` must be specified");
    }

    if (check < 1) {
      throw new ImmigrationError("Migration `check` should not be less than 1");
    }

    // Run a migration.
    const exec = async (name: string) => {
      const path = join(this.directory, name);
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const module = require(path);
      const fn = module[direction];

      // Skip missing up/down methods.
      if (fn === undefined) {
        this.emit("skip", name);
        return;
      }

      // Fail when the migration is invalid.
      if (typeof fn !== "function") {
        throw new ImmigrationError(
          `Migration ${direction} is not a function: ${name}`,
          undefined,
          path
        );
      }

      this.emit("start", name);
      const start = now();

      try {
        await fn();

        this.emit("end", name, true, now() - start);

        if (direction === "up") {
          await this.update(name, true);
        } else {
          await this.remove(name);
        }
      } catch (error) {
        this.emit("end", name, false, now() - start);

        // Allow `SafeMigrationError` to simply undo the status.
        if (error instanceof SafeMigrationError) {
          throw new ImmigrationError(error.message, error.cause, path);
        }

        await this.update(name, false);

        throw new ImmigrationError(
          `Migration ${direction} failed: ${name}. Please fix the migration and update the state before trying again`,
          error,
          path
        );
      }
    };

    // Attempt to run the migrations.
    const migrated = await this.acquire(
      async (files: string[]) => {
        await files.reduce<Promise<void>>(
          (p, file) => p.then(() => exec(file)),
          Promise.resolve()
        );

        return files;
      },
      async () => {
        // Load historical migrations to check.
        const history = iter(
          this.history({
            count: check,
            gte: direction === "down" ? to : undefined,
            reverse: true,
          })
        );

        // Grab the latest execution to compare with file system.
        const latest = await next(history, undefined);

        // Verify the latest migration states are correct before continuing.
        if (latest) {
          const allHistory = chain([latest], iterable(history));

          const files = this.list({
            count: check,
            gte: direction === "down" ? to : undefined,
            lte: latest.name,
            reverse: true,
          });

          for await (const [execution, file] of zipLongest(allHistory, files)) {
            if (execution === undefined || (file ?? "") > execution.name) {
              throw new ImmigrationError(
                `The migration (${JSON.stringify(file)}) has not been run yet`
              );
            }

            if (file === undefined || file < execution.name) {
              throw new ImmigrationError(
                `The migration (${JSON.stringify(
                  execution.name
                )}) cannot be found`
              );
            }

            if (!execution.valid) {
              throw new ImmigrationError(
                `Migration (${JSON.stringify(
                  execution.name
                )}) is in an invalid state`
              );
            }
          }
        }

        const files = await list(
          direction === "down"
            ? this.list({ gte: to, lte: latest?.name, reverse: true })
            : this.list({ gte: latest?.name, lte: to, reverse: false })
        );

        if (direction === "up") {
          // Exclude the latest run migration on `up`.
          if (files[0] === latest?.name) files.shift();
        } else {
          // Exclude the last migration on `down`.
          if (files[files.length - 1] === to) files.pop();
        }

        // Skip the migration attempt when there are no files.
        if (files.length === 0) return NO_ATTEMPT;

        if (dryRun) {
          for (const file of files) this.emit("plan", file);
          return NO_ATTEMPT;
        }

        return files;
      },
      options
    );

    return migrated ?? [];
  }

  async acquire<V, T>(
    fn: (arg: V) => Promise<T>,
    shouldTry: () => Promise<V | typeof NO_ATTEMPT>,
    options: AcquireOptions
  ): Promise<T | undefined> {
    // Default waits for 10 minutes and retries every 500ms.
    const maxWait = options.maxWait ?? 600_000;
    const retryWait = options.retryWait ?? 500;
    const start = now();

    const attempt = async (count: number) => {
      const arg = await shouldTry();
      if (arg === NO_ATTEMPT) return undefined;

      try {
        await this.lock();
      } catch (error) {
        return new Promise<T | undefined>((resolve, reject) => {
          const duration = now() - start;

          // Allow lock retries. This is useful as we will re-attempt which
          // may no longer require any migrations to lock to run.
          if (error instanceof LockRetryError && duration < maxWait) {
            this.emit("wait", count + 1, duration, maxWait);
            setTimeout(() => resolve(attempt(count + 1)), retryWait);
            return;
          }

          return reject(error);
        });
      }

      try {
        return await fn(arg);
      } finally {
        await this.unlock();
      }
    };

    return attempt(0);
  }

  async *list(options: ListOptions): AsyncIterable<string> {
    const { gte, lte, reverse } = options;
    let files = await fs.readdir(this.directory);

    files = files
      .filter((filename) => extname(filename) === this.extension)
      .sort();

    const startIndex = gte ? files.indexOf(gte) : 0;
    const endIndex = lte ? files.indexOf(lte) : files.length - 1;

    if (startIndex === -1) {
      const name = JSON.stringify(gte);
      throw new ImmigrationError(
        `Migration (${name}) does not exist in migrations`
      );
    }

    if (endIndex === -1) {
      const name = JSON.stringify(lte);
      throw new ImmigrationError(
        `Migration (${name}) does not exist in migrations`
      );
    }

    files = files.slice(startIndex, endIndex + 1);

    // Invert order when reverse flag is passed.
    if (reverse) files.reverse();

    // Limit results to requested `count`.
    if (options.count) files = files.slice(0, options.count);

    yield* files;
  }
}

/**
 * JSON entry for each migration `name`.
 */
interface FsStoreEntry {
  valid: boolean;
  date: string;
}

/**
 * Format of the JSON storage file.
 */
type FsStoreJson = Partial<Record<string, FsStoreEntry>>;

/**
 * Filesystem store.
 */
export const FS_STORAGE = {
  create(options: PluginOptions): Store {
    const path = join(options.cwd, ".migrate.json");
    const lockfile = `${path}.lock`;
    let pending = Promise.resolve();

    function toExecution(name: string, value: FsStoreEntry): Execution {
      return {
        name: name,
        valid: value.valid,
        date: new Date(value.date),
      };
    }

    function updateStore(fn: (file: FsStoreJson) => FsStoreJson) {
      pending = pending.then(async () => {
        const contents = await read();
        const update = fn(contents);
        await fs.writeFile(path, JSON.stringify(update, null, 2));
      });

      return pending;
    }

    async function read(): Promise<FsStoreJson> {
      try {
        const text = await fs.readFile(path, "utf8");
        return JSON.parse(text);
      } catch {
        return {};
      }
    }

    async function update(name: string, valid: boolean, date: Date) {
      return updateStore((contents) => {
        contents[name] = { valid, date: date.toISOString() };
        return contents;
      });
    }

    async function remove(name: string) {
      let exists = false;
      await updateStore((contents) => {
        if (contents.hasOwnProperty(name)) {
          exists = true;
          delete contents[name];
        }
        return contents;
      });
      return exists;
    }

    async function show(name: string) {
      const contents = await read();
      if (!contents.hasOwnProperty(name)) return;
      return toExecution(name, contents[name]!);
    }

    function lock() {
      return fs.open(lockfile, `wx`).then(
        (fd) => fd.close(),
        (err) => {
          if (err.code === "EEXIST") {
            throw new LockRetryError(err);
          }

          return Promise.reject(err);
        }
      );
    }

    function unlock() {
      return fs.unlink(lockfile).catch(() => undefined);
    }

    function isLocked() {
      return fs.stat(lockfile).then(
        () => true,
        (err) => {
          if (err.code === "ENOENT") {
            return false;
          }

          return Promise.reject<boolean>(err);
        }
      );
    }

    async function* history(options: ListOptions) {
      const { gte, lte, reverse, count } = options;
      const contents = await read();

      const history = Object.keys(contents)
        .sort()
        .filter((key) => {
          if (gte !== undefined && key < gte) return false;
          if (lte !== undefined && key > lte) return false;
          return true;
        })
        .map((key) => toExecution(key, contents[key]!));

      if (reverse) history.reverse();

      yield* history.slice(0, count ?? history.length);
    }

    return { history, lock, isLocked, unlock, show, update, remove };
  },
};
