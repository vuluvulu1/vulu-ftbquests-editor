import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  compound,
  double,
  getLong,
  list,
  setLong,
  long,
  parseSnbt,
  parseSnbtDocument,
  SnbtParseError,
  str,
  writeSnbt,
  writeSnbtDocument,
  type SnbtCompound,
  type SnbtList,
  type SnbtValue,
} from "../src/core/snbt";

const fixture = readFileSync(new URL("./fixtures/chapter.snbt", import.meta.url), "utf8");

function get(value: SnbtValue, ...path: (string | number)[]): SnbtValue {
  let cur = value;
  for (const key of path) {
    if (typeof key === "number") cur = (cur as SnbtList).items[key]!;
    else cur = (cur as SnbtCompound).entries.get(key)!;
    if (cur === undefined) throw new Error(`Missing ${path.join(".")}`);
  }
  return cur;
}

describe("parseSnbt", () => {
  it("parses scalar types", () => {
    const v = parseSnbt("{ a: 1b, b: 2s, c: 3, d: 4L, e: 5.5f, f: 6.0d, g: 7.5, h: true, i: hello, j: \"x\" }");
    const types = [...(v as SnbtCompound).entries.values()].map((x) =>
      x.kind === "number" ? x.type : x.kind,
    );
    expect(types).toEqual(["byte", "short", "int", "long", "float", "double", "double", "bool", "string", "string"]);
  });

  it("parses typed arrays", () => {
    const v = parseSnbt("[I; 1, 2, -3]");
    expect(v).toMatchObject({ kind: "array", type: "int", items: [{ value: 1 }, { value: 2 }, { value: -3 }] });
  });

  it("handles escapes and unicode", () => {
    expect(parseSnbt(`"a\\"b\\\\c"`)).toMatchObject({ value: 'a"b\\c' });
    expect(parseSnbt(`'it\\'s'`)).toMatchObject({ value: "it's" });
    expect(parseSnbt(`"Ağaç ✓"`)).toMatchObject({ value: "Ağaç ✓" });
  });

  it("reads the FTB-style fixture", () => {
    const root = parseSnbt(fixture);
    expect(get(root, "quests", 0, "title")).toMatchObject({ value: "İlk Adım" });
    expect(get(root, "quests", 0, "tasks", 0, "count")).toMatchObject({ type: "long", value: 16 });
    expect(get(root, "quests", 1, "dependencies", 0)).toMatchObject({ value: "1A2B3C4D5E6F7081" });
    expect(get(root, "quests", 0, "description", 2)).toMatchObject({ value: 'Bir "balta" işini kolaylaştırır.' });
  });

  it("reports the location of syntax errors", () => {
    try {
      parseSnbt("{\n\ta: 1\n\tb: }\n}");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SnbtParseError);
      expect((e as SnbtParseError).line).toBe(3);
    }
  });

  it("rejects trailing garbage and unterminated strings", () => {
    expect(() => parseSnbt("{ } x")).toThrow(SnbtParseError);
    expect(() => parseSnbt('{ a: "oops }')).toThrow(SnbtParseError);
  });
});

describe("writeSnbt", () => {
  it("round-trips the fixture byte for byte", () => {
    expect(writeSnbtDocument(parseSnbtDocument(fixture))).toBe(fixture);
  });

  it("round-trips FTB's multi-line typed arrays (UUIDs)", () => {
    const src = "{\n\ttag: {\n\t\tUUID: [I;\n\t\t\t-68256365\n\t\t\t42\n\t\t]\n\t\tshort: [I; 1, 2]\n\t}\n}\n";
    expect(writeSnbtDocument(parseSnbtDocument(src))).toBe(src);
  });

  it("round-trips a BOM and extra blank lines around the root", () => {
    const src = String.fromCharCode(0xfeff) + "\r\n{\r\n\ta: 1\r\n}\r\n\r\n\r\n";
    expect(writeSnbtDocument(parseSnbtDocument(src))).toBe(src);
    expect(parseSnbt(src)).toMatchObject({ kind: "compound" });
  });

  it("round-trips CRLF files", () => {
    const crlf = fixture.replace(/\n/g, "\r\n");
    expect(writeSnbtDocument(parseSnbtDocument(crlf))).toBe(crlf);
  });

  it("keeps types when values are edited", () => {
    const doc = parseSnbtDocument(fixture);
    const quest = get(doc.root, "quests", 0) as SnbtCompound;
    const x = quest.entries.get("x");
    if (x?.kind !== "number") throw new Error("x missing");
    x.value = 3;
    const count = get(quest, "tasks", 0, "count");
    if (count.kind !== "number") throw new Error("count missing");
    count.value = 32;
    const out = writeSnbtDocument(doc);
    expect(out).toContain("x: 3.0d");
    expect(out).toContain("count: 32L");
  });

  it("writes new values in FTB style", () => {
    const quest = compound({
      id: str("0123456789ABCDEF"),
      dependencies: list([str("FEDCBA9876543210")], true),
      tasks: list([compound({ id: str("1111111111111111"), type: str("item"), count: long(8) })]),
      x: double(-0.5),
      rewards: list(),
      "weird key": str('say "hi"'),
    });
    expect(writeSnbt(quest)).toBe(
      [
        "{",
        '\tid: "0123456789ABCDEF"',
        '\tdependencies: ["FEDCBA9876543210"]',
        "\ttasks: [{",
        '\t\tid: "1111111111111111"',
        '\t\ttype: "item"',
        "\t\tcount: 8L",
        "\t}]",
        "\tx: -0.5d",
        "\trewards: [ ]",
        '\t"weird key": "say \\"hi\\""',
        "}",
        "",
      ].join("\n"),
    );
  });

  it("keeps 64-bit longs exact", () => {
    const c = parseSnbt("{ table_id: 6468877635738169977L }") as SnbtCompound;
    expect(getLong(c, "table_id")).toBe(6468877635738169977n);
    setLong(c, "table_id", -9223372036854775807n);
    expect(writeSnbt(c, { trailingNewline: false })).toBe("{ table_id: -9223372036854775807L }");
  });

  it("formats doubles like Java", () => {
    const fmt = (n: number) => writeSnbt(double(n), { trailingNewline: false });
    expect(fmt(1)).toBe("1.0d");
    expect(fmt(0.25)).toBe("0.25d");
    expect(fmt(1e8)).toBe("1.0E8d");
    expect(fmt(0.0001)).toBe("1.0E-4d");
  });
});
