import { describe, expect, it } from "vitest";
import { colorCode, parseLine, parseLines, serializeLine, serializeLines } from "../src/core/mcFormat";

describe("parseLine", () => {
  it("splits into styled runs, with colors resetting formatting", () => {
    expect(parseLine("&6Hint:&r Watch out")).toEqual([
      { color: "6", text: "Hint:" },
      { text: " Watch out", reset: true },
    ]);
    expect(parseLine("&l&aGreen not bold")).toEqual([{ color: "a", text: "Green not bold" }]);
    expect(parseLine("&a&lGreen bold&r")).toEqual([{ color: "a", bold: true, text: "Green bold" }]);
    expect(parseLine("Tips \\& QoL")).toEqual([{ text: "Tips & QoL" }]);
  });
});

describe("serializeLine", () => {
  const roundTrip = (s: string) => serializeLine(parseLine(s));

  it("writes typical FTB texts back unchanged", () => {
    for (const s of ["&6Hint:&r Watch out for &cBloviators&r!", "&eMake a House a Home! &5&l[Important!]", "Plain text", "&a&lBold green", "Rock & Roll"]) {
      expect(roundTrip(s)).toBe(s);
    }
  });

  it("uses minimal codes for style changes", () => {
    expect(serializeLine([{ text: "a", color: "c", bold: true }, { text: "b", color: "c" }])).toBe("&c&la&cb");
    expect(serializeLine([{ text: "a", bold: true }, { text: "b", bold: true, italic: true }, { text: "c" }])).toBe("&la&ob&rc");
    expect(serializeLine([{ text: "x" }, { text: "y", underline: true }])).toBe("x&ny");
  });

  it("keeps explicit &r, which text effect mods use to end tags", () => {
    for (const s of [
      "<grad from=#FFF0A3 to=#F6B800 hue=true f=1.3 sp=50 uni=true>☆☆☆&r The Great Below",
      "The po&k!&rrtal to &d&l<shake>TH&k!&r&d&l<shake>E",
      "The Great Below&r... not much is known",
    ]) {
      expect(roundTrip(s)).toBe(s);
    }
  });

  it("escapes & that would read as a code", () => {
    expect(serializeLine([{ text: "R&D and &a literal" }])).toBe("R\\&D and \\&a literal");
    expect(parseLine(serializeLine([{ text: "&a" }]))).toEqual([{ text: "&a" }]);
  });

  it("keeps each line independent", () => {
    const text = "&aGreen\nplain\n\n&lbold";
    expect(serializeLines(parseLines(text))).toBe(text);
  });
});

it("maps CSS colors to palette codes", () => {
  expect(colorCode("rgb(85, 255, 85)")).toBe("a");
  expect(colorCode("#FFAA00")).toBe("6");
  expect(colorCode("rgb(227, 230, 236)")).toBeUndefined();
});
