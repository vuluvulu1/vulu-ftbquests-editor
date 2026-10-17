import { describe, expect, it } from "vitest";
import { setJsonString } from "../src/core/jsonText";

describe("setJsonString", () => {
  const file = '{\r\n  "a.title": "Old \\"quoted\\"",\r\n  "b": "keep"\r\n}\r\n';

  it("replaces a value in place and keeps everything else", () => {
    const out = setJsonString(file, "a.title", 'New & "better"');
    expect(out).toBe('{\r\n  "a.title": "New & \\"better\\"",\r\n  "b": "keep"\r\n}\r\n');
    expect(JSON.parse(out)).toEqual({ "a.title": 'New & "better"', b: "keep" });
  });

  it("appends new keys with the file's indentation and line endings", () => {
    const out = setJsonString(file, "c.desc", "Line");
    expect(out).toBe('{\r\n  "a.title": "Old \\"quoted\\"",\r\n  "b": "keep",\r\n  "c.desc": "Line"\r\n}\r\n');
    expect(setJsonString("{}", "k", "v")).toBe('{\n  "k": "v"\n}');
  });

  it("does not confuse keys that contain regex characters or are prefixes of others", () => {
    const out = setJsonString('{\n\t"x.y": "1",\n\t"x.y2": "2"\n}', "x.y", "one");
    expect(JSON.parse(out)).toEqual({ "x.y": "one", "x.y2": "2" });
  });
});
