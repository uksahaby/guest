"use client";

import { useState } from "react";
import { uploadCover } from "./actions";

/**
 * The two fields on Event Details that need to answer while you type: the
 * description's remaining characters, and the tag chips.
 *
 * Client components, and only these two. The no-JavaScript rule is a
 * guest-surface rule — a guest may be on a borrowed phone in a hall with
 * no signal — and the organiser's dashboard has never been held to it.
 * Everything else on this page is still a plain server-rendered form.
 */

const DESCRIPTION_MAX = 250;
const TAGS_MAX = 12;
const TAG_MAX = 24;

export function DescriptionField({ value }: { value: string }) {
  const [text, setText] = useState(value);
  const over = text.length > DESCRIPTION_MAX;

  return (
    <div className="fieldset">
      <label className="flabel" htmlFor="description">
        Short Description
      </label>
      <div className="counted">
        <textarea
          id="description"
          name="description"
          className="field"
          rows={3}
          maxLength={DESCRIPTION_MAX}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="A line or two for the top of every guest's invitation."
        />
        <span className={`counter${over ? " over" : ""}`}>
          {text.length}/{DESCRIPTION_MAX}
        </span>
      </div>
    </div>
  );
}

/**
 * "Upload Event Image", which in the mockup is one button sitting in the
 * corner of the Event Details card.
 *
 * A file has to post as multipart and the rest of that card posts as JSON,
 * so the upload needs a form of its own — but the button sits *inside* the
 * batched card, and a form inside a form is invalid HTML that React will
 * tell you about and the browser silently drops.
 *
 * The `form` attribute is the way out: the input lives here, visually
 * where the mockup puts it, and belongs to the upload form rendered as a
 * sibling of the batched one. Choosing a file submits immediately — a
 * second "now upload it" button, for a picker you have already used, is a
 * step nobody wants.
 */
export function CoverUpload({ formId, src }: { formId: string; src: string }) {
  return (
    <div className="cover-upload">
      <label className="ghost with-icon" htmlFor="cover-file">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 16V4m0 0L8 8m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
        </svg>
        Upload Event Image
      </label>
      <input
        id="cover-file"
        form={formId}
        className="visually-hidden"
        type="file"
        name="cover"
        accept="image/jpeg,image/png,image/webp"
        // .form follows the form attribute, so this is still the upload
        // form and never the one wrapped around the card.
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      />
      <span className="cover-thumb">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" />
        <span className="cover-pencil" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" />
          </svg>
        </span>
      </span>
    </div>
  );
}

export function TagEditor({ value }: { value: string[] }) {
  const [tags, setTags] = useState<string[]>(value);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);

  function add() {
    const t = draft.trim().slice(0, TAG_MAX);
    // Case-insensitive, because "Family" and "family" are one tag to
    // everyone except a computer.
    const dup = tags.some((x) => x.toLowerCase() === t.toLowerCase());
    if (t && !dup && tags.length < TAGS_MAX) setTags([...tags, t]);
    setDraft("");
    setAdding(false);
  }

  return (
    <div className="fieldset">
      <span className="flabel">Event Tags</span>
      {/* One hidden field carries the lot, so the server action reads a
          single value and an empty box genuinely means "no tags". */}
      <input type="hidden" name="tags" value={tags.join(",")} />
      <div className="tagrow">
        {tags.map((t) => (
          <span className="tag" key={t}>
            {t}
            <button
              type="button"
              aria-label={`Remove ${t}`}
              onClick={() => setTags(tags.filter((x) => x !== t))}
            >
              ×
            </button>
          </span>
        ))}

        {adding ? (
          <input
            className="tag-input"
            autoFocus
            value={draft}
            maxLength={TAG_MAX}
            placeholder="Tag name"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={add}
            onKeyDown={(e) => {
              // Enter must not submit the whole settings form — inside a
              // form a bare Enter in a text input does exactly that.
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
              if (e.key === "Escape") {
                setDraft("");
                setAdding(false);
              }
            }}
          />
        ) : (
          tags.length < TAGS_MAX && (
            <button type="button" className="tag add" onClick={() => setAdding(true)}>
              + Add Tag
            </button>
          )
        )}
      </div>
    </div>
  );
}
