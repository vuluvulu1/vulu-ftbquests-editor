import { expect, it } from "vitest";
import { stripFormatting } from "../src/ui/McText";

it("strips Minecraft formatting codes and unescapes \\&", () => {
  expect(stripFormatting("&fWelcome")).toBe("Welcome");
  expect(stripFormatting("&fTips, utilities \\& QoL stuff")).toBe("Tips, utilities & QoL stuff");
  expect(stripFormatting("&l&aBold green&r normal §cred")).toBe("Bold green normal red");
  expect(stripFormatting("Rock & Roll")).toBe("Rock & Roll");
});

it("strips text animation tags but keeps other angle-bracket text", () => {
  expect(stripFormatting("<grad from=#F5B3FF to=#A21CAF hue uni><grad from=#F5B3FF to=#A21CAF hue uni>Introduction")).toBe("Introduction");
  expect(stripFormatting("A New Start! <neon p=8 r=2 a=0.15>Go")).toBe("A New Start! Go");
  expect(stripFormatting("<shake>Boss</shake> fight")).toBe("Boss fight");
  expect(stripFormatting("Press <Enter> to continue <3")).toBe("Press <Enter> to continue <3");
});
