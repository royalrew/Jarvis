import { redirect } from "next/navigation";

export default function Home() {
  // Passmallar är mest använt vid gymmet – starta där.
  redirect("/pass");
}
