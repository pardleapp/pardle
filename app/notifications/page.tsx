/**
 * /notifications — Notifications center, opened from the bell icon
 * in SweatHeader. Matches the design-handoff prototype 1:1.
 */

import { BRAND } from "@/lib/brand";
import NotificationsClient from "./NotificationsClient";

export const metadata = {
  title: `Notifications — ${BRAND.name}`,
  description: "Your bet swings, settles, group activity and channel tips.",
};

export default function NotificationsPage() {
  return (
    <main className="container container-wide v4-theme pv-theme">
      <NotificationsClient />
    </main>
  );
}
