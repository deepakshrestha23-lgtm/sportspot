"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { api } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/apiErrors";
import type { RegisterPayload } from "@/types/auth";

type RegisterRole = RegisterPayload["role"];
type SkillLevel = "Beginner" | "Amateur" | "Pro";
type OwnerSport = "Futsal" | "Cricksal" | "Both";
type FieldErrors = Record<string, string>;

const locations = ["Kathmandu", "Lalitpur", "Bhaktapur"];

const skillLevels: SkillLevel[] = ["Beginner", "Amateur", "Pro"];
const ownerSports: OwnerSport[] = ["Futsal", "Cricksal", "Both"];
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const namePattern = /^[A-Za-z][A-Za-z\s.'-]*$/;
const nepaliMobilePattern = /^(977)?9[78]\d{8}$/;

export default function RegisterPage() {
  const router = useRouter();
  const [role, setRole] = useState<RegisterRole>("PLAYER");
  const [showPassword, setShowPassword] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [success, setSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [playerForm, setPlayerForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    location: "",
    preferredSport: "Futsal",
    skillLevel: "Beginner" as SkillLevel,
    password: "",
  });

  const [ownerForm, setOwnerForm] = useState({
    ownerName: "",
    email: "",
    phone: "",
    venueName: "",
    location: "",
    primarySport: "Futsal" as OwnerSport,
    password: "",
  });

  function clearFieldError(field: string) {
    setFieldErrors((currentErrors) => {
      if (!currentErrors[field]) return currentErrors;
      const nextErrors = { ...currentErrors };
      delete nextErrors[field];
      return nextErrors;
    });
  }

  function setFieldError(field: string, message: string) {
    setError("");
    if (!message) {
      clearFieldError(field);
      return;
    }

    setFieldErrors((currentErrors) => ({
      ...currentErrors,
      [field]: message,
    }));
  }

  function handleRoleChange(nextRole: RegisterRole) {
    setRole(nextRole);
    setError("");
    setSuccess("");
    setFieldErrors({});
  }

  function validateName(value: string, label: string) {
    const trimmedValue = value.trim();
    if (!trimmedValue) return `${label} is required.`;
    if (trimmedValue.length < 3) return `${label} must be at least 3 characters.`;
    if (trimmedValue.length > 70) return `${label} must be 70 characters or less.`;
    if (!namePattern.test(trimmedValue)) return `${label} can only use letters, spaces, apostrophes, dots, or hyphens.`;
    return "";
  }

  function validateEmail(value: string) {
    const trimmedValue = value.trim();
    if (!trimmedValue) return "Email address is required.";
    if (trimmedValue.length > 120) return "Email address is too long.";
    if (!emailPattern.test(trimmedValue)) return "Enter a valid email address, for example rahul@example.com.";
    return "";
  }

  function validatePhone(value: string) {
    const compactValue = value.replace(/\D/g, "");
    if (!value.trim()) return "Phone number is required.";
    if (!nepaliMobilePattern.test(compactValue)) return "Use a valid Nepal mobile number, for example 98XXXXXXXX.";
    return "";
  }

  function sanitizePhoneInput(value: string) {
    return value.replace(/\D/g, "").slice(0, 13);
  }

  function validatePassword(value: string) {
    if (!value) return "Password is required.";
    if (value.length < 8) return "Password must be at least 8 characters.";
    if (value.length > 72) return "Password must be 72 characters or less.";
    if (/\s/.test(value)) return "Password cannot contain spaces.";
    if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return "Password must include at least one letter and one number.";
    return "";
  }

  function validateVenueName(value: string) {
    const trimmedValue = value.trim();
    if (!trimmedValue) return "Venue name is required.";
    if (trimmedValue.length < 3) return "Venue name must be at least 3 characters.";
    if (trimmedValue.length > 90) return "Venue name must be 90 characters or less.";
    return "";
  }

  function validateForm() {
    const errors: FieldErrors = {};

    const activeForm = role === "PLAYER" ? playerForm : ownerForm;
    const emailError = validateEmail(activeForm.email);
    const phoneError = validatePhone(activeForm.phone);
    const passwordError = validatePassword(activeForm.password);

    if (emailError) errors.email = emailError;
    if (phoneError) errors.phone = phoneError;
    if (passwordError) errors.password = passwordError;

    if (role === "PLAYER") {
      const fullNameError = validateName(playerForm.fullName, "Full name");
      if (fullNameError) errors.fullName = fullNameError;
      if (!playerForm.location) errors.location = "Please select your city.";
      if (!["Cricksal", "Futsal"].includes(playerForm.preferredSport)) {
        errors.preferredSport = "Please select a valid sport.";
      }
      if (!skillLevels.includes(playerForm.skillLevel)) {
        errors.skillLevel = "Please select a valid skill level.";
      }
    }

    if (role === "COURT_OWNER") {
      const ownerNameError = validateName(ownerForm.ownerName, "Owner name");
      if (ownerNameError) errors.ownerName = ownerNameError;
      const venueNameError = validateVenueName(ownerForm.venueName);
      if (venueNameError) errors.venueName = venueNameError;
      if (!ownerForm.location) errors.location = "Please select your city.";
      if (!ownerSports.includes(ownerForm.primarySport)) {
        errors.primarySport = "Please select a valid supported sport.";
      }
    }

    if (!acceptedTerms) {
      errors.terms = "You must agree before creating an account.";
    }

    setFieldErrors(errors);
    return errors;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");

    const validationErrors = validateForm();
    if (Object.keys(validationErrors).length > 0) {
      setError("Please fix the highlighted fields.");
      return;
    }

    const payload: RegisterPayload =
      role === "PLAYER"
        ? {
            full_name: playerForm.fullName.trim(),
            email: playerForm.email.trim(),
            phone: playerForm.phone.trim(),
            password: playerForm.password,
            role: "PLAYER",
          }
        : {
            full_name: ownerForm.ownerName.trim(),
            email: ownerForm.email.trim(),
            phone: ownerForm.phone.trim(),
            password: ownerForm.password,
            role: "COURT_OWNER",
          };

    setIsSubmitting(true);

    try {
      await api.post("/api/auth/register/", payload);
      setSuccess("Account created successfully. Redirecting to login...");
      setTimeout(() => router.push("/login"), 900);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Registration failed. Please check your details and try again."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-[calc(100vh-73px)] bg-slate-50 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl">
        <Link href="/" className="mb-7 flex flex-col items-center gap-2 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-sportGreen text-lg font-black text-white shadow-sm">
            SS
          </span>
          <span className="text-2xl font-black tracking-tight text-sportNavy">SportSpot</span>
        </Link>

        <form
          className="overflow-hidden rounded-xl border border-slate-200 border-t-4 border-t-sportGreen bg-white p-6 shadow-xl shadow-slate-200/70 sm:p-8"
          onSubmit={handleSubmit}
        >
          <div className="text-center">
            <h1 className="text-3xl font-black tracking-tight text-sportNavy">Create Account</h1>
            <p className="mt-3 text-sm text-slate-600">Join Nepal&apos;s premier sports matchmaking network.</p>
          </div>

          <div className="mx-auto mt-7 grid max-w-md grid-cols-2 rounded-full bg-slate-100 p-1">
            <RoleButton active={role === "PLAYER"} icon="player" label="Player" onClick={() => handleRoleChange("PLAYER")} />
            <RoleButton
              active={role === "COURT_OWNER"}
              icon="venue"
              label="Court Owner"
              onClick={() => handleRoleChange("COURT_OWNER")}
            />
          </div>

          {error ? <p className="mt-6 rounded-md bg-red-50 p-3 text-sm font-medium text-red-700">{error}</p> : null}
          {success ? (
            <p className="mt-6 rounded-md bg-green-50 p-3 text-sm font-medium text-green-700">{success}</p>
          ) : null}

          {role === "PLAYER" ? (
            <div className="mt-8 grid gap-5 sm:grid-cols-2">
              <Field error={fieldErrors.fullName} label="Full Name">
                <input
                  className={getInputClassName(Boolean(fieldErrors.fullName))}
                  maxLength={70}
                  onChange={(event) => {
                    const fullName = event.target.value;
                    setPlayerForm({ ...playerForm, fullName });
                    setFieldError("fullName", fullName ? validateName(fullName, "Full name") : "");
                  }}
                  onBlur={() => setFieldError("fullName", validateName(playerForm.fullName, "Full name"))}
                  placeholder="e.g. Rahul Sharma"
                  required
                  value={playerForm.fullName}
                />
              </Field>

              <Field error={fieldErrors.email} label="Email Address">
                <input
                  className={getInputClassName(Boolean(fieldErrors.email))}
                  maxLength={120}
                  onChange={(event) => {
                    const email = event.target.value;
                    setPlayerForm({ ...playerForm, email });
                    setFieldError("email", email ? validateEmail(email) : "");
                  }}
                  onBlur={() => setFieldError("email", validateEmail(playerForm.email))}
                  placeholder="rahul@example.com"
                  required
                  type="email"
                  value={playerForm.email}
                />
              </Field>

              <Field error={fieldErrors.phone} label="Phone Number">
                <input
                  className={getInputClassName(Boolean(fieldErrors.phone))}
                  inputMode="tel"
                  maxLength={13}
                  onChange={(event) => {
                    const phone = sanitizePhoneInput(event.target.value);
                    setPlayerForm({ ...playerForm, phone });
                    setFieldError("phone", phone ? validatePhone(phone) : "");
                  }}
                  onBlur={() => setFieldError("phone", validatePhone(playerForm.phone))}
                  pattern="[0-9]*"
                  placeholder="98XXXXXXXX"
                  required
                  type="text"
                  value={playerForm.phone}
                />
              </Field>

              <Field error={fieldErrors.location} label="Location">
                <select
                  className={getInputClassName(Boolean(fieldErrors.location))}
                  onChange={(event) => {
                    const location = event.target.value;
                    setPlayerForm({ ...playerForm, location });
                    setFieldError("location", location ? "" : "Please select your city.");
                  }}
                  onBlur={() => setFieldError("location", playerForm.location ? "" : "Please select your city.")}
                  required
                  value={playerForm.location}
                >
                  <option value="">Select your City</option>
                  {locations.map((location) => (
                    <option key={location} value={location}>
                      {location}
                    </option>
                  ))}
                </select>
              </Field>

              <Field error={fieldErrors.preferredSport} label="Preferred Sport">
                <select
                  className={getInputClassName(Boolean(fieldErrors.preferredSport))}
                  onChange={(event) => {
                    const preferredSport = event.target.value;
                    setPlayerForm({ ...playerForm, preferredSport });
                    setFieldError("preferredSport", ["Cricksal", "Futsal"].includes(preferredSport) ? "" : "Please select a valid sport.");
                  }}
                  value={playerForm.preferredSport}
                >
                  <option value="Cricksal">Cricksal</option>
                  <option value="Futsal">Futsal</option>
                </select>
              </Field>

              <Field error={fieldErrors.skillLevel} label="Skill Level">
                <SegmentedControl
                  options={skillLevels}
                  selected={playerForm.skillLevel}
                  onSelect={(skillLevel) => {
                    setPlayerForm({ ...playerForm, skillLevel });
                    setFieldError("skillLevel", "");
                  }}
                />
              </Field>

              <Field className="sm:col-span-2" error={fieldErrors.password} label="Create Password">
                <PasswordInput
                  hasError={Boolean(fieldErrors.password)}
                  onToggle={() => setShowPassword((value) => !value)}
                  onValueChange={(password) => {
                    setPlayerForm({ ...playerForm, password });
                    setFieldError("password", password ? validatePassword(password) : "");
                  }}
                  onValidate={() => setFieldError("password", validatePassword(playerForm.password))}
                  showPassword={showPassword}
                  value={playerForm.password}
                />
              </Field>
            </div>
          ) : (
            <div className="mt-8 grid gap-5 sm:grid-cols-2">
              <Field error={fieldErrors.ownerName} label="Owner Name">
                <input
                  className={getInputClassName(Boolean(fieldErrors.ownerName))}
                  maxLength={70}
                  onChange={(event) => {
                    const ownerName = event.target.value;
                    setOwnerForm({ ...ownerForm, ownerName });
                    setFieldError("ownerName", ownerName ? validateName(ownerName, "Owner name") : "");
                  }}
                  onBlur={() => setFieldError("ownerName", validateName(ownerForm.ownerName, "Owner name"))}
                  placeholder="Full legal name"
                  required
                  value={ownerForm.ownerName}
                />
              </Field>

              <Field error={fieldErrors.venueName} label="Venue Name">
                <input
                  className={getInputClassName(Boolean(fieldErrors.venueName))}
                  maxLength={90}
                  onChange={(event) => {
                    const venueName = event.target.value;
                    setOwnerForm({ ...ownerForm, venueName });
                    setFieldError("venueName", venueName ? validateVenueName(venueName) : "");
                  }}
                  onBlur={() => setFieldError("venueName", validateVenueName(ownerForm.venueName))}
                  placeholder="e.g. Kathmandu Futsal Arena"
                  required
                  value={ownerForm.venueName}
                />
              </Field>

              <Field error={fieldErrors.email} label="Email Address">
                <input
                  className={getInputClassName(Boolean(fieldErrors.email))}
                  maxLength={120}
                  onChange={(event) => {
                    const email = event.target.value;
                    setOwnerForm({ ...ownerForm, email });
                    setFieldError("email", email ? validateEmail(email) : "");
                  }}
                  onBlur={() => setFieldError("email", validateEmail(ownerForm.email))}
                  placeholder="owner@venue.com"
                  required
                  type="email"
                  value={ownerForm.email}
                />
              </Field>

              <Field error={fieldErrors.phone} label="Contact Phone">
                <input
                  className={getInputClassName(Boolean(fieldErrors.phone))}
                  inputMode="tel"
                  maxLength={13}
                  onChange={(event) => {
                    const phone = sanitizePhoneInput(event.target.value);
                    setOwnerForm({ ...ownerForm, phone });
                    setFieldError("phone", phone ? validatePhone(phone) : "");
                  }}
                  onBlur={() => setFieldError("phone", validatePhone(ownerForm.phone))}
                  pattern="[0-9]*"
                  placeholder="98XXXXXXXX"
                  required
                  type="text"
                  value={ownerForm.phone}
                />
              </Field>

              <Field error={fieldErrors.location} label="Location">
                <select
                  className={getInputClassName(Boolean(fieldErrors.location))}
                  onChange={(event) => {
                    const location = event.target.value;
                    setOwnerForm({ ...ownerForm, location });
                    setFieldError("location", location ? "" : "Please select your city.");
                  }}
                  onBlur={() => setFieldError("location", ownerForm.location ? "" : "Please select your city.")}
                  required
                  value={ownerForm.location}
                >
                  <option value="">Select your City</option>
                  {locations.map((location) => (
                    <option key={location} value={location}>
                      {location}
                    </option>
                  ))}
                </select>
              </Field>

              <Field error={fieldErrors.primarySport} label="Primary Sport Supported">
                <SegmentedControl
                  options={ownerSports}
                  selected={ownerForm.primarySport}
                  onSelect={(primarySport) => {
                    setOwnerForm({ ...ownerForm, primarySport });
                    setFieldError("primarySport", "");
                  }}
                />
              </Field>

              <Field className="sm:col-span-2" error={fieldErrors.password} label="Create Password">
                <PasswordInput
                  hasError={Boolean(fieldErrors.password)}
                  onToggle={() => setShowPassword((value) => !value)}
                  onValueChange={(password) => {
                    setOwnerForm({ ...ownerForm, password });
                    setFieldError("password", password ? validatePassword(password) : "");
                  }}
                  onValidate={() => setFieldError("password", validatePassword(ownerForm.password))}
                  showPassword={showPassword}
                  value={ownerForm.password}
                />
              </Field>
            </div>
          )}

          <label className="mt-6 flex items-start gap-3 text-xs leading-5 text-slate-600">
            <input
              checked={acceptedTerms}
              className={`mt-1 h-4 w-4 rounded text-sportGreen focus:ring-sportGreen ${
                fieldErrors.terms ? "border-red-400" : "border-slate-300"
              }`}
              onChange={(event) => {
                const isChecked = event.target.checked;
                setAcceptedTerms(isChecked);
                setFieldError("terms", isChecked ? "" : "You must agree before creating an account.");
              }}
              required
              type="checkbox"
            />
            <span>
              By creating an account, I agree to SportSpot&apos;s{" "}
              <Link className="font-semibold text-sportGreen hover:text-green-700" href="#">
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link className="font-semibold text-sportGreen hover:text-green-700" href="#">
                Privacy Policy
              </Link>
              .
              {fieldErrors.terms ? <span className="mt-1 block font-semibold text-red-600">{fieldErrors.terms}</span> : null}
            </span>
          </label>

          <button
            className="mt-7 w-full rounded-md bg-green-700 px-5 py-4 text-lg font-black text-white shadow-lg shadow-green-900/15 transition hover:-translate-y-0.5 hover:bg-green-800 disabled:cursor-not-allowed disabled:bg-slate-400 disabled:hover:translate-y-0"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? "Creating Account..." : "Sign Up Now →"}
          </button>

          <div className="mt-8 border-t border-slate-200 pt-6 text-center text-sm text-slate-600">
            Already have an account?{" "}
            <Link className="font-bold text-sportGreen hover:text-green-700" href="/login">
              Login here
            </Link>
          </div>
        </form>
      </div>
    </main>
  );
}

const baseInputClassName =
  "mt-2 h-12 w-full rounded-md border bg-white px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:ring-2";

function getInputClassName(hasError = false) {
  return `${baseInputClassName} ${
    hasError ? "border-red-400 focus:border-red-500 focus:ring-red-100" : "border-slate-300 focus:border-sportGreen focus:ring-green-100"
  }`;
}

function Field({
  children,
  className = "",
  error,
  label,
}: {
  children: React.ReactNode;
  className?: string;
  error?: string;
  label: string;
}) {
  return (
    <label className={`block text-xs font-bold text-slate-950 ${className}`}>
      {label}
      {children}
      {error ? <span className="mt-1 block text-xs font-semibold text-red-600">{error}</span> : null}
    </label>
  );
}

function RoleButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: "player" | "venue";
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex h-12 items-center justify-center gap-2 rounded-full text-sm font-bold transition ${
        active ? "bg-green-700 text-white shadow-md shadow-green-900/15" : "text-slate-700 hover:bg-white"
      }`}
      onClick={onClick}
      type="button"
    >
      {icon === "player" ? <PlayerIcon /> : <VenueIcon />}
      {label}
    </button>
  );
}

function SegmentedControl<T extends string>({
  options,
  selected,
  onSelect,
}: {
  options: T[];
  selected: T;
  onSelect: (option: T) => void;
}) {
  return (
    <div className="mt-2 grid h-12 grid-cols-3 rounded-md bg-slate-100 p-1">
      {options.map((option) => (
        <button
          className={`rounded text-xs font-semibold transition ${
            selected === option ? "bg-white text-sportGreen shadow-sm" : "text-slate-700 hover:bg-white/70"
          }`}
          key={option}
          onClick={() => onSelect(option)}
          type="button"
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function PasswordInput({
  hasError,
  onToggle,
  onValidate,
  onValueChange,
  showPassword,
  value,
}: {
  hasError: boolean;
  onToggle: () => void;
  onValidate: () => void;
  onValueChange: (value: string) => void;
  showPassword: boolean;
  value: string;
}) {
  return (
    <div className="relative mt-2">
      <input
        className={`${getInputClassName(hasError)} mt-0 pr-12`}
        minLength={8}
        maxLength={72}
        onChange={(event) => onValueChange(event.target.value)}
        onBlur={onValidate}
        placeholder="Min. 8 characters"
        required
        type={showPassword ? "text" : "password"}
        value={value}
      />
      <button
        aria-label={showPassword ? "Hide password" : "Show password"}
        className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        onClick={onToggle}
        type="button"
      >
        <EyeIcon isOpen={!showPassword} />
      </button>
    </div>
  );
}

function PlayerIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <path
        d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function VenueIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <path
        d="M4 21h16M6 21V8l6-4 6 4v13M9 21v-6h6v6M9 10h.01M15 10h.01"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function EyeIcon({ isOpen }: { isOpen: boolean }) {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path
        d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      {!isOpen ? (
        <path
          d="M4 4l16 16"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      ) : null}
    </svg>
  );
}
