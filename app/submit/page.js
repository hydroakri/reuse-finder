"use client";

import { useState } from "react";
import Link from "next/link";

const CATEGORIES = ["repair", "borrow", "rent", "used"];

const EMPTY_FORM = {
  item: "",
  category: "repair",
  suburb: "",
  source: "",
  source_url: "",
  notes: "",
  image_url: "",
  contact: "",
  publish_unverified: false,
  submitter_contact: "",
  company_website: "", // honeypot — must stay empty; hidden from real users via CSS
};

export default function SubmitPage() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [status, setStatus] = useState("idle"); // idle | submitting | success | error
  const [errorMessage, setErrorMessage] = useState("");
  // Captured at submit time, since the form (including publish_unverified)
  // resets right after a successful submission -- the success message needs
  // to know which path was actually taken.
  const [lastSubmissionWasUnverified, setLastSubmissionWasUnverified] = useState(false);

  function updateField(field) {
    return (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setStatus("submitting");
    setErrorMessage("");

    try {
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Submission failed.");
      }

      setLastSubmissionWasUnverified(form.publish_unverified);
      setStatus("success");
      setForm(EMPTY_FORM);
    } catch (err) {
      setStatus("error");
      setErrorMessage(err.message);
    }
  }

  return (
    <main className="page">
      <p>
        <Link href="/">&larr; Back to search</Link>
      </p>
      <header className="page-header">
        <h1>Suggest a listing</h1>
        <p>
          By default, submissions are reviewed by a team member before they
          appear in search results — this keeps every listing manually
          verified. You can opt to skip that and show your listing
          immediately, clearly marked as unverified instead.
        </p>
      </header>

      {status === "success" ? (
        <p className="status-note">
          {lastSubmissionWasUnverified
            ? "Thanks — your listing is now visible, marked as unverified from the community."
            : "Thanks — your submission has been sent for review."}
        </p>
      ) : (
        <form className="submit-form" onSubmit={handleSubmit}>
          <label>
            Item / service *
            <input
              type="text"
              required
              value={form.item}
              onChange={updateField("item")}
            />
          </label>
          <label>
            Category *
            <select value={form.category} onChange={updateField("category")}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label>
            Suburb *
            <input
              type="text"
              required
              value={form.suburb}
              onChange={updateField("suburb")}
            />
          </label>
          <label>
            Source / provider name *
            <input
              type="text"
              required
              value={form.source}
              onChange={updateField("source")}
            />
          </label>
          <label>
            Source URL *
            <input
              type="url"
              required
              value={form.source_url}
              onChange={updateField("source_url")}
            />
          </label>
          <label>
            Notes (hours, fees, eligibility, etc.)
            <textarea value={form.notes} onChange={updateField("notes")} />
          </label>
          <label>
            Photo URL (optional)
            <input
              type="url"
              value={form.image_url}
              onChange={updateField("image_url")}
            />
          </label>
          <label>
            Venue contact / phone (optional)
            <input
              type="text"
              value={form.contact}
              onChange={updateField("contact")}
            />
          </label>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={form.publish_unverified}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, publish_unverified: e.target.checked }))
              }
            />
            Show this immediately, marked &quot;unverified, from the community&quot; —
            skips our review queue (SCRUM-78). Leave unchecked to go through
            the normal manual-verification process instead.
          </label>
          <label>
            Your contact (optional, in case we have questions)
            <input
              type="text"
              value={form.submitter_contact}
              onChange={updateField("submitter_contact")}
            />
          </label>

          {/* Honeypot field: hidden from real users, left empty by them.
              Simple bots that auto-fill every field will trip it. */}
          <label className="honeypot-field" aria-hidden="true">
            Company website
            <input
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={form.company_website}
              onChange={updateField("company_website")}
            />
          </label>

          <button type="submit" disabled={status === "submitting"}>
            {status === "submitting" ? "Submitting..." : "Submit for review"}
          </button>

          {status === "error" && (
            <p className="status-note status-error">{errorMessage}</p>
          )}
        </form>
      )}
    </main>
  );
}
