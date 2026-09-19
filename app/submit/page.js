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
  submitter_contact: "",
  company_website: "", // honeypot — must stay empty; hidden from real users via CSS
};

export default function SubmitPage() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [status, setStatus] = useState("idle"); // idle | submitting | success | error
  const [errorMessage, setErrorMessage] = useState("");

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
          Submissions are reviewed by a team member before they appear in
          search results — this keeps every listing manually verified.
        </p>
      </header>

      {status === "success" ? (
        <p className="status-note">
          Thanks — your submission has been sent for review.
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
