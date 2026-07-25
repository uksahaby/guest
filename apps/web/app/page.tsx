import { redirect } from "next/navigation";
import { getToken } from "@/lib/org-api";

export default async function Root() {
  redirect((await getToken()) ? "/events" : "/login");
}
