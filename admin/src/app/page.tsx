import { redirect } from "next/navigation";

// ponytail: root just redirects to dashboard, auth check happens in dashboard layout
export default function Home() {
  redirect("/dashboard");
}
