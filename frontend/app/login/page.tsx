"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import { getDashboardPath, saveAuthSession } from "@/lib/auth";
import type { LoginResponse } from "@/types/auth";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await api.post<LoginResponse>("/api/auth/login/", {
        email: email.trim(),
        password,
      });
      saveAuthSession(response.data);
      router.push(getDashboardPath(response.data.user.role));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Invalid email or password."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-73px)] max-w-md items-center px-4 py-12">
      <form className="w-full rounded-lg border border-slate-200 bg-white p-6 shadow-sm" onSubmit={handleSubmit}>
        <h1 className="text-2xl font-bold text-sportNavy">Login</h1>
        <p className="mt-2 text-sm text-slate-600">Access your SportSpot account.</p>

        {error ? <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

        <label className="mt-6 block text-sm font-semibold text-slate-700" htmlFor="email">
          Email
        </label>
        <input
          className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-sportGreen"
          id="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />

        <label className="mt-4 block text-sm font-semibold text-slate-700" htmlFor="password">
          Password
        </label>
        <input
          className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-sportGreen"
          id="password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />

        <button
          className="mt-6 w-full rounded-md bg-sportGreen px-4 py-2 font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-slate-400"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? "Logging in..." : "Login"}
        </button>

        <p className="mt-5 text-center text-sm text-slate-600">
          No account?{" "}
          <Link className="font-semibold text-sportGreen" href="/register">
            Register
          </Link>
        </p>
      </form>
    </main>
  );
}
