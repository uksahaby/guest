"use client";

import { useState } from "react";

/**
 * The password inputs from both mockups: an eye to reveal, and on sign-up
 * a live checklist plus a confirm box.
 *
 * The checklist states the rule this system ACTUALLY enforces. The mockup
 * promises "at least 8 characters, one uppercase letter, one number";
 * credentials.ts requires ten characters and nothing else, on purpose —
 * "length is what actually helps", and composition rules mostly produce
 * Password1! Showing the mockup's three ticks would be a page telling a
 * confident lie about what happens when you press the button.
 */

export const MIN_PASSWORD = 10;

function Eye({ shown }: { shown: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7" />
      <circle cx="12" cy="12" r="3" />
      {shown && <path d="M3 3l18 18" />}
    </svg>
  );
}

function Lock() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 11h12v10H6zM9 11V8a3 3 0 0 1 6 0v3" />
    </svg>
  );
}

function Rule({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span className={`prule${ok ? " ok" : ""}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        {ok && <path d="m8.5 12 2.5 2.5 4.5-5" />}
      </svg>
      {children}
    </span>
  );
}

/** Sign-in: one box, with a reveal. */
export function PasswordInput({
  name = "password",
  placeholder = "Enter your password",
  autoComplete = "current-password",
}: {
  name?: string;
  placeholder?: string;
  autoComplete?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="inputwrap">
      <span className="lead"><Lock /></span>
      <input
        className="field"
        name={name}
        type={shown ? "text" : "password"}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required
      />
      <button
        type="button"
        className="reveal"
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        onClick={() => setShown((s) => !s)}
      >
        <Eye shown={shown} />
      </button>
    </div>
  );
}

/** Sign-up: the rule, live, and a confirm box that says when it disagrees. */
export function NewPasswordFields() {
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [shown, setShown] = useState(false);
  const [shown2, setShown2] = useState(false);

  const longEnough = pw.length >= MIN_PASSWORD;
  const matches = again.length > 0 && again === pw;
  const mismatch = again.length > 0 && again !== pw;

  return (
    <>
      <label className="flabel" htmlFor="password">Password</label>
      <div className="inputwrap">
        <span className="lead"><Lock /></span>
        <input
          id="password"
          className="field"
          name="password"
          type={shown ? "text" : "password"}
          placeholder="Create a password"
          autoComplete="new-password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          minLength={MIN_PASSWORD}
          maxLength={200}
          required
        />
        <button type="button" className="reveal" aria-pressed={shown}
          aria-label={shown ? "Hide password" : "Show password"}
          onClick={() => setShown((s) => !s)}>
          <Eye shown={shown} />
        </button>
      </div>

      <div className="prules">
        <Rule ok={longEnough}>At least {MIN_PASSWORD} characters</Rule>
        <span className="phint">
          Length is the whole rule. A long ordinary phrase beats a short
          clever one.
        </span>
      </div>

      <label className="flabel" htmlFor="password2">Confirm password</label>
      <div className={`inputwrap${mismatch ? " bad" : ""}`}>
        <span className="lead"><Lock /></span>
        <input
          id="password2"
          className="field"
          type={shown2 ? "text" : "password"}
          placeholder="Confirm your password"
          autoComplete="new-password"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
          required
        />
        <button type="button" className="reveal" aria-pressed={shown2}
          aria-label={shown2 ? "Hide password" : "Show password"}
          onClick={() => setShown2((s) => !s)}>
          <Eye shown={shown2} />
        </button>
      </div>
      {mismatch && (
        <span className="prule bad-text">Those two don&rsquo;t match yet.</span>
      )}
      {matches && longEnough && (
        <span className="prule ok">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" />
          </svg>
          Both match.
        </span>
      )}
    </>
  );
}

/**
 * The phone box, with +234 sitting in front of it as the mockup shows.
 *
 * The prefix is a label, not a value — the field still accepts 0803…,
 * +234…, or a number from anywhere written with its own country code,
 * because the server reads all of those (phone.ts). Forcing the +234 in as
 * a real prefix would break exactly the international case it appears to
 * help with.
 */
export function PhoneInput({
  defaultValue = "",
  autoFocus = false,
}: {
  defaultValue?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="inputwrap phone">
      <span className="lead flag" aria-hidden="true">
        <svg viewBox="0 0 24 16" aria-hidden="true">
          <rect width="8" height="16" fill="#008751" />
          <rect x="8" width="8" height="16" fill="#fff" />
          <rect x="16" width="8" height="16" fill="#008751" />
        </svg>
      </span>
      <input
        className="field"
        name="phone"
        type="tel"
        inputMode="tel"
        placeholder="0803 411 2098"
        autoComplete="username"
        defaultValue={defaultValue}
        autoFocus={autoFocus}
        required
      />
    </div>
  );
}
