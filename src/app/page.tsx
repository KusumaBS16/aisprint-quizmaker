import { redirect } from "next/navigation";

// Unconditional, because there is no session to inspect. Every visitor starts at the login
// form; the day sessions exist, this is the one place that has to learn to check for one.
export default function Home() {
  redirect("/login");
}
