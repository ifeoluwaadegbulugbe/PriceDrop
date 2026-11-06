import { redirect } from "next/navigation";

/** The page is called Saved items now. Old links keep working. */
export default function WatchlistPage() {
  redirect("/saved");
}
