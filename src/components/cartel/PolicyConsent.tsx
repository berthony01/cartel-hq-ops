import { Link } from "@tanstack/react-router";
import { useId } from "react";

/** Required consent checkbox. Unchecked consent must block the guarded action. */
export function PolicyConsent({
  checked,
  onChange,
  variant,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  variant: "signup" | "checkout";
}) {
  const id = useId();
  return (
    <div className="flex min-h-11 items-start gap-3">
      <input
        id={id}
        type="checkbox"
        required
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 size-5 shrink-0 accent-[var(--gold)]"
      />
      <label htmlFor={id} className="text-xs leading-relaxed text-muted-foreground">
        I agree to the{" "}
        <Link to="/legal/terms" target="_blank" className="font-semibold text-gold underline-offset-4 hover:underline">Terms of Service</Link>
        {variant === "checkout" ? (
          <>
            {" "}and{" "}
            <Link to="/legal/refunds" target="_blank" className="font-semibold text-gold underline-offset-4 hover:underline">Refund &amp; Cancellation Policy</Link>
            , including that Pro renews monthly until cancelled and cancellation takes effect at period end
          </>
        ) : null}
        , and I have read the{" "}
        <Link to="/legal/privacy" target="_blank" className="font-semibold text-gold underline-offset-4 hover:underline">Privacy Notice</Link>.
      </label>
    </div>
  );
}
