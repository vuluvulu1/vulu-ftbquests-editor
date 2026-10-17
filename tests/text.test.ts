import { expect, it } from "vitest";
import { translateText, translationKey } from "../src/core/text";

it("recognizes {translation.key} texts only", () => {
  expect(translationKey("{ftbquests.chapter.6nvampirism__vampire.title}")).toBe("ftbquests.chapter.6nvampirism__vampire.title");
  expect(translationKey("{@pagebreak}")).toBeUndefined();
  expect(translationKey('{"text":"json"}')).toBeUndefined();
  expect(translationKey("Hello {x}")).toBeUndefined();
});

it("translates whole texts and description lines, keeping unknown keys", () => {
  const t = new Map([
    ["a.title", "Vampire"],
    ["a.desc0", "&aBite"],
  ]);
  expect(translateText("{a.title}", t)).toBe("Vampire");
  expect(translateText("{a.desc0}\n\nplain\n{missing.key}", t)).toBe("&aBite\n\nplain\n{missing.key}");
  expect(translateText("{a.title}", null)).toBe("{a.title}");
});
