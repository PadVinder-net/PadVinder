import { afterEach, expect, test, vi } from "vitest";
import { logInWithCode, logOut, requestLoginCode } from "./auth-client";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(answer: () => Response | Promise<Response>) {
  const requests: Request[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new Request(input, init));
    return answer();
  });
  return requests;
}

const wrongCode = () => Response.json({ code: "INVALID_OTP", message: "x" }, { status: 400 });

test("a wrong code maps to wrong_code", async () => {
  stubFetch(wrongCode);
  expect(await logInWithCode("a@example.test", "000000")).toEqual({
    ok: false,
    error: "wrong_code",
  });
});

test.each([
  ["OTP_EXPIRED", "code_expired"],
  ["TOO_MANY_ATTEMPTS", "too_many_attempts"],
])("%s maps to %s", async (code, error) => {
  stubFetch(() => Response.json({ code, message: "x" }, { status: 400 }));
  expect(await logInWithCode("a@example.test", "000000")).toEqual({ ok: false, error });
});

test("an invalid address maps to invalid_email", async () => {
  stubFetch(() =>
    Response.json({ code: "INVALID_EMAIL", message: "Invalid email" }, { status: 400 }),
  );
  expect(await requestLoginCode("nope")).toEqual({ ok: false, error: "invalid_email" });
});

const ipLimit = () =>
  Response.json({ message: "Too many requests. Please try again later." }, { status: 429 });

test.each([
  ["TOO_MANY_LOGIN_CODES", "too_many_codes"],
  ["TOO_MANY_LOGIN_CODES_TODAY", "too_many_codes_today"],
])("429 %s on requesting a code maps to %s", async (code, error) => {
  stubFetch(() => Response.json({ code, message: "x" }, { status: 429 }));
  expect(await requestLoginCode("a@example.test")).toEqual({ ok: false, error });
});

test("429 without our code is the limit per IP address: too_busy", async () => {
  stubFetch(ipLimit);
  expect(await requestLoginCode("a@example.test")).toEqual({ ok: false, error: "too_busy" });
  expect(await logInWithCode("a@example.test", "000000")).toEqual({
    ok: false,
    error: "too_busy",
  });
});

test("a network failure maps to failed and does not throw", async () => {
  stubFetch(() => {
    throw new TypeError("Failed to fetch");
  });
  expect(await requestLoginCode("a@example.test")).toEqual({ ok: false, error: "failed" });
  expect(await logInWithCode("a@example.test", "000000")).toEqual({ ok: false, error: "failed" });
  expect(await logOut()).toEqual({ ok: false, error: "failed" });
});

test("a failing sign-out is reported", async () => {
  stubFetch(() => Response.json({ code: "X" }, { status: 500 }));
  expect(await logOut()).toEqual({ ok: false, error: "failed" });
});

test("an unknown error maps to failed", async () => {
  stubFetch(() => Response.json({ code: "SOMETHING_NEW" }, { status: 500 }));
  expect(await logInWithCode("a@example.test", "000000")).toEqual({ ok: false, error: "failed" });
});

test("success is ok, and sends what the API expects", async () => {
  const requests = stubFetch(() => Response.json({ success: true }));
  expect(await requestLoginCode("a@example.test")).toEqual({ ok: true });
  expect(await logInWithCode("a@example.test", "123456")).toEqual({ ok: true });
  expect(await logOut()).toEqual({ ok: true });
  expect(requests.map((r) => [r.method, new URL(r.url).pathname])).toEqual([
    ["POST", "/api/auth/email-otp/send-verification-otp"],
    ["POST", "/api/auth/sign-in/email-otp"],
    ["POST", "/api/auth/sign-out"],
  ]);
  expect(await requests[0]!.json()).toEqual({ email: "a@example.test", type: "sign-in" });
  expect(await requests[1]!.json()).toEqual({ email: "a@example.test", otp: "123456" });
});

test("never asks for the session, which the API does not serve", async () => {
  const requests = stubFetch(() => Response.json({ success: true }));
  await requestLoginCode("a@example.test");
  await logInWithCode("a@example.test", "123456");
  await logOut();
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(requests.some((r) => r.url.includes("get-session"))).toBe(false);
});
