import { expect, test } from "vitest";
import { mailAppUrl } from "./open-mail-app";

test.each([
  ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15", "message://"],
  ["Mozilla/5.0 (iPad; CPU OS 18_4 like Mac OS X) AppleWebKit/605.1.15", "message://"],
  [
    "Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36",
    "intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.APP_EMAIL;end",
  ],
  ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15", null],
])("mailAppUrl for %s", (userAgent, expected) => {
  expect(mailAppUrl(userAgent)).toEqual(expected);
});
