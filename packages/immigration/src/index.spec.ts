import { join } from "path";
import { promises as fs } from "fs";
import { FS_STORAGE, Migrate } from "./index";
import { list } from "iterative/dist/async";

const MIGRATION_DIRECTORY = join(__dirname, "../test/migrations");
const OUT_DIRECTORY = join(__dirname, "../test/out");

const getFiles = async () => {
  const files = await fs.readdir(OUT_DIRECTORY);
  return files.sort().filter((x) => x !== ".gitignore");
};

const migrate = new Migrate({
  directory: MIGRATION_DIRECTORY,
  storage: FS_STORAGE,
});

it("should not be locked", async () => {
  const isLocked = await migrate.isLocked();
  expect(isLocked).toEqual(false);
});

describe("list", () => {
  it("should list all files", async () => {
    const files = migrate.list({});
    expect(await list(files)).toEqual(["1_test.js", "2_test.js"]);
  });

  it("should limit by count", async () => {
    const files = migrate.list({ count: 1 });
    expect(await list(files)).toEqual(["1_test.js"]);
  });

  it("should limit by count in reverse", async () => {
    const files = migrate.list({ count: 1, reverse: true });
    expect(await list(files)).toEqual(["2_test.js"]);
  });
});

describe("with no migrations", () => {
  beforeEach(async () => {
    const files = await getFiles();
    await Promise.all(
      files.map((file) => fs.unlink(join(OUT_DIRECTORY, file)))
    );

    try {
      await fs.unlink(join(process.cwd(), ".migrate.json"));
    } catch {}
  });

  it("should migrate up", async () => {
    const migrations = await migrate.migrate("up", { all: true });
    expect(migrations).toEqual(["1_test.js", "2_test.js"]);

    expect(await getFiles()).toEqual(["1", "2"]);
  });

  it("should have empty history", async () => {
    const history = migrate.history({});
    expect(await list(history)).toEqual([]);
  });

  it("should return empty state", async () => {
    const entry = await migrate.show("1_test.js");
    expect(entry).toBe(undefined);
  });

  describe("with existing migrations", () => {
    beforeEach(async () => {
      await migrate.migrate("up", { all: true });
    });

    describe("history", () => {
      it("should have history", async () => {
        const history = migrate.history({});
        const items = await list(history);
        expect(items.map((x) => x.name)).toEqual(["1_test.js", "2_test.js"]);
      });

      it("should reverse history", async () => {
        const history = migrate.history({ reverse: true });
        const items = await list(history);
        expect(items.map((x) => x.name)).toEqual(["2_test.js", "1_test.js"]);
      });

      it("should limit history", async () => {
        const history = migrate.history({ count: 1 });
        const items = await list(history);
        expect(items.map((x) => x.name)).toEqual(["1_test.js"]);
      });

      it("should limit history in reverse", async () => {
        const history = migrate.history({ count: 1, reverse: true });
        const items = await list(history);
        expect(items.map((x) => x.name)).toEqual(["2_test.js"]);
      });
    });

    it("should show state", async () => {
      const entry = await migrate.show("1_test.js");
      expect(entry?.name).toBe("1_test.js");
      expect(entry?.valid).toBe(true);
      expect(entry?.date).toBeInstanceOf(Date);
    });

    it("should migrate down all", async () => {
      const migrations = await migrate.migrate("down", { all: true });
      expect(migrations).toEqual(["2_test.js", "1_test.js"]);

      expect(await getFiles()).toEqual([]);
    });

    it("should migrate down to specific file", async () => {
      const migrations = await migrate.migrate("down", { to: "1_test.js" });
      expect(migrations).toEqual(["2_test.js"]);

      expect(await getFiles()).toEqual(["1"]);
    });

    it("should only migrate down once", async () => {
      const migrations = await migrate.migrate("down", { to: "1_test.js" });
      expect(migrations).toEqual(["2_test.js"]);

      const migrations2 = await migrate.migrate("down", { to: "1_test.js" });
      expect(migrations2).toEqual([]);

      expect(await getFiles()).toEqual(["1"]);
    });
  });
});
