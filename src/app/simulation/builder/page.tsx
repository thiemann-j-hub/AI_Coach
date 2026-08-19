import { Suspense } from "react";
import BuilderClient from "./BuilderClient";

/** Welle C — Self-Service-Szenario-Builder (Kunden-Admins). */
export default function BuilderPage() {
  return (
    <Suspense>
      <BuilderClient />
    </Suspense>
  );
}
