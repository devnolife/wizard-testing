"use client";

import { useState } from "react";

export default function LoginPage() {
  const [user, setUser] = useState("");

  // Intentional broken flow: submitting does nothing (no navigation, no feedback).
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // BUG: meant to sign the user in and redirect, but does nothing.
  }

  return (
    <main>
      <h1>Login</h1>
      <form onSubmit={handleSubmit}>
        {/* Intentional a11y issue: input without an associated label. */}
        <input
          type="text"
          placeholder="username"
          value={user}
          onChange={(e) => setUser(e.target.value)}
        />
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
